// Release Q, part Q2 — the FIXED CASE TABLE for single-qubit gates, circuits and protocols, then adversarial and
// contract tests. Oracle values were computed by the integrator (numpy, ~/jurislab-relE/oracle_quantum.py, section Q2).
// Every later fix round must keep every row's outcome (cumulative gate); reviewers add rows at the end of the table.
//
// Further reference values (Grover on 3 qubits, Deutsch–Jozsa, superdense coding, QFT on 3 qubits) come from this
// oracle, run in C:\Users\AlexanderSmith\jurislab-oracle-venv:
//   import numpy as np, math
//   H=np.array([[1,1],[1,-1]])/math.sqrt(2); I=np.eye(2); X=np.array([[0,1],[1,0]]); Z=np.diag([1,-1])
//   def kron(*m):
//       r=np.array([[1]])
//       for x in m: r=np.kron(r,x)
//       return r
//   N=8; s=np.ones(N)/math.sqrt(N); O=np.eye(N); O[5,5]=-1; D=2*np.outer(s,s)-np.eye(N)
//   v=s.copy(); ps=[abs(v[5])**2]
//   for k in range(2): v=D@O@v; ps.append(abs(v[5])**2)          # -> [0.125, 0.78125, 0.9453125]
//   def dj(n,f):
//       Nn=2**(n+1); U=np.zeros((Nn,Nn))
//       for x in range(2**n):
//           for y in (0,1): U[(x<<1)|(y^f[x]),(x<<1)|y]=1
//       st=np.zeros(Nn); st[1]=1
//       st=kron(*([H]*(n+1)))@st; st=U@st; st=kron(*([H]*n+[I]))@st
//       return abs(st[0])**2+abs(st[1])**2                         # balanced -> 0, constant -> 1
//   # superdense: (Z^b1 X^b2 ⊗ I)|Φ+>, then (H⊗I)·CNOT -> |b1 b2> exactly
//   w=np.exp(2j*math.pi/8); F=np.array([[w**(j*k) for k in range(8)] for j in range(8)])/math.sqrt(8)
//   F[:,6]  # QFT|110> = (1, −i, −1, i, 1, −i, −1, i)/(2√2)
import { QUANTUM_GATES_CALCS } from "../quantumGatesCalcs";
import type { AnalyzeOutput } from "../analyzeBlocks";
import {
  GATES,
  applyGate,
  basisState,
  blochVector,
  cx,
  fmtReal,
  fmtState,
  marginal,
  matMul,
  matNear,
  measureQubit,
  parseAngle,
  parseKet,
  purity,
  recogniseReal,
  reducedDensity,
  rotationOf,
  rx,
  ry,
  rz,
  u3,
  phaseGate,
  isUnitary,
} from "../quantumCore";
import { dftMatrix, grover, parseCircuit, parseGateSequence, qftOps, simulate, teleport, deutschJozsa, superdense } from "../quantumCircuits";
import { BELL_STATES } from "../quantum";
import { mathToOmml } from "../mathOmml";

const calc = (id: string) => {
  const c = QUANTUM_GATES_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(`no calculator ${id}`);
  return c;
};
const run = (id: string, over: Record<string, string> = {}): AnalyzeOutput => {
  const c = calc(id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
};
const out = (o: AnalyzeOutput, key: string): number => {
  const v = o.outputs?.find((x) => x.key === key);
  if (!v) throw new Error(`no output ${key}: ${o.text}`);
  return v.value;
};
const near = (a: number, b: number, tol = 5e-7): void => {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
};
const okText = (o: AnalyzeOutput): string => {
  expect(o.ok).not.toBe(false);
  return o.text;
};

describe("fixed case table (Release Q, part Q2)", () => {
  test("H|0⟩ → (|0⟩ + |1⟩)/√2, displayed exactly", () => {
    const o = run("qc-single-qubit", { start: "0", gates: "H" });
    expect(okText(o)).toContain("(|0⟩ + |1⟩)/√2");
    near(out(o, "alphaRe"), Math.SQRT1_2, 1e-12);
    near(out(o, "betaRe"), Math.SQRT1_2, 1e-12);
    expect(fmtState(applyGate(basisState(1, 0), 1, GATES.H, [0]), 1).math).toBe("{ket(0) + ket(1)}/sqrt(2)");
  });

  test("H Z H equals X (unitary identity shown)", () => {
    const o = run("qc-single-qubit", { start: "0", gates: "H Z H" });
    expect(okText(o)).toContain("= X exactly");
    expect(o.blocks?.some((b) => b.kind === "math" && b.math === "H Z H = X")).toBe(true);
    const seq = parseGateSequence("H Z H");
    if ("error" in seq) throw new Error(seq.error);
    expect(matNear(matMul(seq[2].U, matMul(seq[1].U, seq[0].U)), GATES.X, 1e-12)).toBe(true);
  });

  test("Ry(60°)|0⟩ → P(0) 0.75, P(1) 0.25 (exact ¾, ¼)", () => {
    const o = run("qc-single-qubit", { start: "0", gates: "Ry(60)" });
    near(out(o, "p0"), 0.75, 1e-12);
    near(out(o, "p1"), 0.25, 1e-12);
    expect(okText(o)).toContain("P(0) = |α|² = ¾, P(1) = |β|² = ¼");
  });

  test("Rz(90°) after Rx(60°) on |0⟩ → (0.612372 − 0.612372i, 0.353553 − 0.353553i); Bloch (0.866025, 0, 0.5)", () => {
    // Time order: Rx(60) FIRST, then Rz(90). The reverse order gives a different state (checked below).
    const o = run("qc-single-qubit", { start: "0", gates: "Rx(60) Rz(90)" });
    near(out(o, "alphaRe"), 0.612372);
    near(out(o, "alphaIm"), -0.612372);
    near(out(o, "betaRe"), 0.353553);
    near(out(o, "betaIm"), -0.353553);
    near(out(o, "blochX"), 0.866025);
    near(out(o, "blochY"), 0);
    near(out(o, "blochZ"), 0.5);
    const t = okText(o);
    expect(t).toContain("0.612372 − 0.612372i");
    expect(t).toContain("exp(−iπ/4)·((√3/2)|0⟩ + ½|1⟩)");
    expect(t).toContain("global phase exp(−iπ/4)");
    const rev = run("qc-single-qubit", { start: "0", gates: "Rz(90) Rx(60)" });
    expect(Math.abs(out(rev, "blochX") - 0.866025)).toBeGreaterThan(0.1);
  });

  test("H 0; CNOT 0 1 on |00⟩ → (|00⟩ + |11⟩)/√2", () => {
    const o = run("qc-circuit", { n: "2", init: "", circuit: "H 0\nCNOT 0 1" });
    expect(okText(o)).toContain("(|00⟩ + |11⟩)/√2");
    near(out(o, "p_00"), 0.5, 1e-12);
    near(out(o, "p_11"), 0.5, 1e-12);
    near(out(o, "concurrence"), 1, 1e-12);
  });

  test("GHZ: H 0; CNOT 0 1; CNOT 1 2 → (|000⟩ + |111⟩)/√2", () => {
    const o = run("qc-circuit", { n: "3", init: "", circuit: "H 0\nCNOT 0 1\nCNOT 1 2" });
    expect(okText(o)).toContain("(|000⟩ + |111⟩)/√2");
    near(out(o, "p_000"), 0.5, 1e-12);
    near(out(o, "p_111"), 0.5, 1e-12);
    for (const q of [0, 1, 2]) near(out(o, `purity_q${q}`), 0.5, 1e-12);
  });

  test("Teleport α = 0.6, β = 0.8i → each outcome ¼; every corrected output 0.6|0⟩ + 0.8i|1⟩", () => {
    const o = run("qc-teleport", { alpha: "0.6", beta: "0.8i" });
    for (const k of ["p00", "p01", "p10", "p11"]) near(out(o, k), 0.25, 1e-12);
    near(out(o, "fidelity"), 1, 1e-12);
    const t = teleport([cx(0.6), cx(0, 0.8)]);
    for (const b of t.branches) {
      near(b.corrected[0].re, 0.6, 1e-12);
      near(b.corrected[0].im, 0, 1e-12);
      near(b.corrected[1].re, 0, 1e-12);
      near(b.corrected[1].im, 0.8, 1e-12);
    }
    const tb = o.blocks?.find((b) => b.kind === "table");
    expect(tb && tb.kind === "table" && tb.rows.slice(1).every((r) => r[4] === "0.6|0⟩ + 0.8i|1⟩" && r[1] === "¼")).toBe(true);
  });

  test("Grover 2 qubits, marked |11⟩, 1 iteration → P(|11⟩) = 1", () => {
    const o = run("qc-grover", { n: "2", marked: "11", iters: "1" });
    near(out(o, "pMarked"), 1, 1e-12);
    expect(okText(o)).toContain("P(|11⟩) = 1");
  });

  test("QFT on |01⟩ (2 qubits) → (|00⟩ + i|01⟩ − |10⟩ − i|11⟩)/2", () => {
    const o = run("qc-qft", { n: "2", input: "01" });
    expect(okText(o)).toContain("(|00⟩ + i|01⟩ − |10⟩ − i|11⟩)/2");
    near(out(o, "re_00"), 0.5, 1e-12);
    near(out(o, "im_01"), 0.5, 1e-12);
    near(out(o, "re_10"), -0.5, 1e-12);
    near(out(o, "im_11"), -0.5, 1e-12);
  });

  test("Mach–Zehnder φ = 60° → P(0) = cos²30° = 0.75", () => {
    const o = run("qc-interference", { setup: "mz", phi: "60" });
    near(out(o, "p0"), 0.75, 1e-12);
    expect(okText(o)).toContain("P(0) = cos²(π/6) = ¾");
  });

  test("Unnormalised input 1|0⟩ + 1|1⟩ → normalised with a note", () => {
    const o = run("qc-single-qubit", { start: "dirac", state: "1|0⟩ + 1|1⟩", gates: "" });
    const t = okText(o);
    expect(t).toContain("normalised");
    expect(t).toContain("(|0⟩ + |1⟩)/√2");
    near(out(o, "p0"), 0.5, 1e-12);
  });

  test("11 qubits → named refusal (≤ 10)", () => {
    const o = run("qc-circuit", { n: "11", circuit: "H 0" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/1 to 10/);
    expect(o.text).toMatch(/10 qubits/);
  });

  test("Gate on a qubit index ≥ n, or CNOT with control = target → named refusal", () => {
    const a = run("qc-circuit", { n: "3", circuit: "H 3" });
    expect(a.ok).toBe(false);
    expect(a.text).toMatch(/qubit 3 does not exist/);
    const b = run("qc-circuit", { n: "3", circuit: "CNOT 1 1" });
    expect(b.ok).toBe(false);
    expect(b.text).toMatch(/control and the target are the same qubit/);
  });
});

describe("further reference rows (numpy oracle in the header)", () => {
  test("Grover 3 qubits, marked |101⟩: P = ⅛, 25/32, 121/128 after 0, 1, 2 iterations; 2 is optimal", () => {
    const g = grover(3, 5, 2);
    near(g.pPerIter[0], 0.125, 1e-12);
    near(g.pPerIter[1], 0.78125, 1e-12);
    near(g.pPerIter[2], 0.9453125, 1e-12);
    const o = run("qc-grover", { n: "3", marked: "101", iters: "" });
    near(out(o, "optimal"), 2, 0);
    near(out(o, "pMarked"), 0.9453125, 1e-12);
    expect(o.text).toContain("121/128");
  });

  test("Deutsch–Jozsa: balanced → P(all 0) = 0, constant → 1 (n = 1, 2, 3)", () => {
    near(deutschJozsa(2, [0, 1, 1, 0]).pZero, 0, 1e-12);
    near(deutschJozsa(2, [1, 1, 1, 1]).pZero, 1, 1e-12);
    near(deutschJozsa(3, [0, 1, 1, 0, 1, 0, 0, 1]).pZero, 0, 1e-12);
    near(deutschJozsa(1, [0, 1]).pZero, 0, 1e-12);
    near(deutschJozsa(1, [0, 0]).pZero, 1, 1e-12);
    expect(okText(run("qc-deutsch-jozsa", { n: "3", oracle: "c1" }))).toContain("CONSTANT");
    expect(okText(run("qc-deutsch-jozsa", { n: "3", oracle: "table", table: "0 1 1 0 1 0 0 1" }))).toContain("BALANCED");
  });

  test("Superdense coding: bits b₁b₂ → Bell state → decoded |b₁b₂⟩ with certainty", () => {
    const expected = ["(|00⟩ + |11⟩)/√2", "(|01⟩ + |10⟩)/√2", "(|00⟩ − |11⟩)/√2", "(|01⟩ − |10⟩)/√2"];
    for (let k = 0; k < 4; k++) {
      const sd = superdense((k >> 1) as 0 | 1, (k & 1) as 0 | 1);
      expect(fmtState(sd.shared, 2).text).toBe(expected[k]);
      near(sd.final[k].re, 1, 1e-12);
    }
    const o = run("qc-superdense", { bits: "all" });
    for (const k of ["00", "01", "10", "11"]) near(out(o, `p_${k}`), 1, 1e-12);
  });

  test("QFT circuit equals the DFT matrix ω^{jk}/√N (2 and 3 qubits); QFT|110⟩ = (1, −i, −1, i, …)/(2√2)", () => {
    for (const n of [2, 3]) {
      const F = dftMatrix(n);
      for (let x = 0; x < 1 << n; x++) {
        const col = simulate({ n, ops: qftOps(n) }, x);
        col.forEach((z, y) => {
          near(z.re, F[y][x].re, 1e-12);
          near(z.im, F[y][x].im, 1e-12);
        });
      }
    }
    const o = run("qc-qft", { n: "3", input: "110" });
    expect(okText(o)).toContain("(|000⟩ − i|001⟩ − |010⟩ + i|011⟩ + |100⟩ − i|101⟩ − |110⟩ + i|111⟩)/(2√2)");
  });

  test("Bell preparation gives quantum.ts's BELL_STATES for all four inputs", () => {
    const keys = ["Phi+", "Psi+", "Phi-", "Psi-"];
    for (let k = 0; k < 4; k++) {
      const s = simulate({ n: 2, ops: (parseCircuit("H 0\nCNOT 0 1", 2) as { ops: never[] }).ops }, k);
      s.forEach((z, i) => near(z.re, BELL_STATES[keys[k]][i].re, 1e-12));
    }
    const o = run("qc-bell", { which: "all" });
    expect(okText(o)).toContain("|11⟩ → |Ψ⁻⟩ = (|01⟩ − |10⟩)/√2");
  });
});

describe("the core", () => {
  test("closed forms are recognised to 10⁻¹² and only then", () => {
    expect(fmtReal(Math.SQRT1_2).text).toBe("1/√2");
    expect(fmtReal(Math.sqrt(3) / 2).text).toBe("√3/2");
    expect(fmtReal(-0.5).text).toBe("−½");
    expect(fmtReal(Math.SQRT1_2 / 2).text).toBe("1/(2√2)");
    expect(fmtReal(0.6).text).toBe("0.6");
    expect(fmtReal(Math.SQRT1_2 + 1e-9).exact).toBe(false);
    expect(fmtReal(1 / 3).text).toBe("0.333333");
    expect(recogniseReal(NaN)).toBeNull();
  });

  test("big-endian: X on qubit 0 of 3 gives |100⟩ (index 4)", () => {
    const s = applyGate(basisState(3, 0), 3, GATES.X, [0]);
    expect(s[4].re).toBe(1);
  });

  test("rotation gates follow exp(−iθσ/2); Rz differs from P by a global phase; U(θ,φ,λ) is Qiskit's", () => {
    near(rz(Math.PI / 2)[0][0].re, Math.SQRT1_2, 1e-15);
    near(rz(Math.PI / 2)[0][0].im, -Math.SQRT1_2, 1e-15);
    expect(matNear(u3(Math.PI / 2, 0, Math.PI), GATES.H, 1e-12)).toBe(true);
    expect(matNear(u3(Math.PI, Math.PI / 2, Math.PI / 2), GATES.Y, 1e-12)).toBe(true);
    for (const t of [0.3, 2, -1]) for (const g of [rx(t), ry(t), rz(t), phaseGate(t)]) expect(isUnitary(g)).toBe(true);
  });

  test("rotationOf: H is π about (x + z)/√2; the identity has no axis", () => {
    const r = rotationOf(GATES.H);
    near(r.theta, Math.PI, 1e-12);
    near(r.axis![0], Math.SQRT1_2, 1e-12);
    near(r.axis![2], Math.SQRT1_2, 1e-12);
    expect(rotationOf(GATES.I).axis).toBeNull();
  });

  test("partial measurement renormalises; marginals and reduced purity", () => {
    const bell = applyGate(applyGate(basisState(2, 0), 2, GATES.H, [0]), 2, GATES.X, [1], [0]);
    const m = measureQubit(bell, 2, 0, 1);
    near(m.prob, 0.5, 1e-12);
    near(m.post![3].re, 1, 1e-12);
    expect(marginal(bell, 2, [1])).toEqual([expect.closeTo(0.5, 12), expect.closeTo(0.5, 12)]);
    near(purity(reducedDensity(bell, 2, [0])), 0.5, 1e-12);
    expect(blochVector([cx(1), cx(0)])).toEqual([0, 0, 1]);
  });

  test("parseKet: named states, Bell states, errors by name", () => {
    expect((parseKet("|−⟩") as { state: { re: number }[] }).state[1].re).toBeCloseTo(-Math.SQRT1_2, 12);
    expect((parseKet("|Φ⁺⟩") as { n: number }).n).toBe(2);
    expect(parseKet("")).toHaveProperty("error");
    expect(parseKet("0|0⟩")).toHaveProperty("error");
    expect((parseKet("|0⟩ + |01⟩") as { error: string }).error).toMatch(/same number of qubits/);
    expect((parseKet("(|0⟩ + |1⟩)/sqrt(2)") as { error: string }).error).toMatch(/coefficient|BEFORE|Brackets/);
    expect((parseKet("|00000000000⟩") as { error: string }).error).toMatch(/10 qubits/);
  });

  test("parseAngle: degrees by default, radians with π or rad, refusals", () => {
    near((parseAngle("90") as { rad: number }).rad, Math.PI / 2, 1e-15);
    near((parseAngle("pi/4") as { rad: number }).rad, Math.PI / 4, 1e-15);
    near((parseAngle("30°") as { rad: number }).rad, Math.PI / 6, 1e-15);
    near((parseAngle("0.5 rad") as { rad: number }).rad, 0.5, 1e-15);
    expect(parseAngle("i")).toHaveProperty("error");
    expect(parseAngle("1e9")).toHaveProperty("error");
    expect(parseAngle("abc")).toHaveProperty("error");
  });
});

describe("adversarial inputs", () => {
  test.each([
    ["qc-single-qubit", { gates: "H Q" }, /not a gate/],
    ["qc-single-qubit", { gates: "Rx" }, /needs an angle/],
    ["qc-single-qubit", { gates: "Rx(abc)" }, /angle/],
    ["qc-single-qubit", { gates: "H(30)" }, /takes no angle/],
    ["qc-single-qubit", { gates: "U(1, 2)" }, /three angles/],
    ["qc-single-qubit", { gates: "Rx(30" }, /unclosed/],
    ["qc-single-qubit", { start: "dirac", state: "0|0⟩ + 0|1⟩" }, /zero/],
    ["qc-single-qubit", { start: "dirac", state: "|00⟩" }, /ONE qubit/],
    ["qc-single-qubit", { start: "dirac", state: "Infinity|0⟩" }, /not a finite number/],
    ["qc-single-qubit", { start: "bloch", theta: "200" }, /0° to 180°/],
    ["qc-single-qubit", { start: "bloch", theta: "5 kg" }, /angle/],
    ["qc-circuit", { n: "0" }, /1 to 10/],
    ["qc-circuit", { n: "2.5" }, /whole number/],
    ["qc-circuit", { n: "" }, /whole number/],
    ["qc-circuit", { n: "3", init: "01" }, /3 bits|exactly 3/],
    ["qc-circuit", { n: "3", init: "012" }, /bits/],
    ["qc-circuit", { n: "3", circuit: "" }, /empty/],
    ["qc-circuit", { n: "3", circuit: "CNOT 0" }, /2 qubits/],
    ["qc-circuit", { n: "3", circuit: "CCX 0 0 1" }, /twice|same/],
    ["qc-circuit", { n: "3", circuit: "MEASURE 0\nH 0" }, /already been measured/],
    ["qc-circuit", { n: "3", circuit: "H -1" }, /Unexpected|whole numbers/],
    ["qc-circuit", { n: "3", circuit: "CU 0 1" }, /CU needs/],
    ["qc-circuit", { n: "3", circuit: "H 0 0" }, /twice/],
    ["qc-teleport", { alpha: "0", beta: "0" }, /both zero/],
    ["qc-teleport", { alpha: "", beta: "1" }, /required/],
    ["qc-deutsch-jozsa", { n: "2", oracle: "table", table: "0 1 1 1" }, /neither constant nor balanced/],
    ["qc-deutsch-jozsa", { n: "2", oracle: "table", table: "0 1" }, /needs 4 values/],
    ["qc-deutsch-jozsa", { n: "2", oracle: "table", table: "0 2 1 0" }, /0 or 1/],
    ["qc-grover", { n: "2", marked: "1" }, /2 bits/],
    ["qc-grover", { n: "2", iters: "21" }, /0 to 20/],
    ["qc-qft", { n: "2", input: "011" }, /3 bits given/],
    ["qc-qft", { n: "3", input: "0.6|00⟩ + 0.8|11⟩" }, /2 qubits/],
  ] as [string, Record<string, string>, RegExp][])("%s %j → named refusal", (id, over, re) => {
    const o = run(id, over);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re);
    expect(o.text).not.toMatch(/NaN|Infinity|undefined|—/);
  });

  test("a measured qubit may still be a control (deferred measurement)", () => {
    const o = run("qc-circuit", { n: "2", circuit: "H 0\nMEASURE 0\nCX 0 1" });
    expect(okText(o)).toContain("(|00⟩ + |11⟩)/√2");
    near(out(o, "m_0"), 0.5, 1e-12);
  });

  test("ten qubits, 200 gates: the deterministic work bound holds and the result is summarised", () => {
    const lines = Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? `H ${i % 10}` : i % 3 === 1 ? `CCX ${i % 10} ${(i + 1) % 10} ${(i + 2) % 10}` : `RY(${i}) ${(i + 5) % 10}`));
    const o = run("qc-circuit", { n: "10", circuit: lines.join("\n") });
    const t = okText(o);
    expect(t).not.toMatch(/NaN|Infinity|undefined/);
    // 201 gate lines is one too many.
    const big = run("qc-circuit", { n: "10", circuit: [...lines, "H 0"].join("\n") });
    expect(big.ok).toBe(false);
    expect(big.text).toMatch(/200/);
  });

  test("huge and tiny amplitudes normalise; −0 never shows", () => {
    const o = run("qc-single-qubit", { start: "dirac", state: "1e-200|0⟩ + 1e-200|1⟩", gates: "" });
    expect(okText(o)).toContain("(|0⟩ + |1⟩)/√2");
    const z = run("qc-single-qubit", { start: "1", gates: "X" });
    expect(z.text).not.toMatch(/−0(?![.\d])/);
  });

  test("Grover past the optimum falls again; n = 2 global sign is explained", () => {
    const o = run("qc-grover", { n: "2", marked: "01", iters: "2" });
    near(out(o, "pMarked"), 0.25, 1e-12);
    expect(o.text).toMatch(/rotate past/);
    expect(run("qc-grover", { n: "2", marked: "11", iters: "1" }).text).toMatch(/global phase/);
  });
});

describe("display contract and Release E shape, every tool at its defaults and at the case rows", () => {
  const runs: [string, AnalyzeOutput][] = [
    ...QUANTUM_GATES_CALCS.map((c) => [c.id, run(c.id)] as [string, AnalyzeOutput]),
    ["single Rx Rz", run("qc-single-qubit", { gates: "Rx(60) Rz(90)" })],
    ["single all gates", run("qc-single-qubit", { gates: "I X Y Z H S S† T Tdg √X Rx(pi/3) Ry(10) Rz(-20) P(45) U(30, 60, 90)" })],
    ["single bloch", run("qc-single-qubit", { start: "bloch", theta: "pi/3", phi: "45" })],
    ["circuit all gates", run("qc-circuit", { n: "4", circuit: "H 0\nCY 0 1\nCH 1 2\nCS 2 3\nCRZ(45) 0 3\nCP(pi/8) 1 3\nSWAP 0 2\niSWAP 1 2\nCSWAP 0 1 3\nCCZ 0 1 2\nCU(U(90, 0, 180)) 3 0\nMEASURE 0 1" })],
    ["hh", run("qc-interference", { setup: "hh" })],
    ["hzh", run("qc-interference", { setup: "hzh" })],
    ["bell one", run("qc-bell", { which: "10" })],
    ["superdense one", run("qc-superdense", { bits: "11" })],
    ["dj c0 n1", run("qc-deutsch-jozsa", { n: "1", oracle: "c0" })],
    ["qft dirac", run("qc-qft", { n: "2", input: "0.6|00⟩ + 0.8i|11⟩" })],
  ];
  test.each(runs)("%s: ok, no caret / e-notation / NaN / em dash; outputs; math parses; a figure", (_id, o) => {
    const t = okText(o);
    expect(t).not.toMatch(/\^|NaN|Infinity|undefined|—/);
    expect(t).not.toMatch(/\d[eE][-+]?\d/);
    expect(t).not.toMatch(/(^|[\s(])-\d/m);
    expect(o.outputs?.length).toBeGreaterThan(0);
    expect(o.outputs!.every((x) => Number.isFinite(x.value))).toBe(true);
    const blocks = o.blocks ?? [];
    for (const b of blocks) if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
    expect(blocks.some((b) => b.kind === "math")).toBe(true);
    expect(blocks.some((b) => b.kind === "table")).toBe(true);
    const plots = blocks.filter((b) => b.kind === "plot");
    expect(plots.length).toBeGreaterThan(0);
    for (const p of plots) if (p.kind === "plot") expect(p.svg).toMatch(/^<svg[\s\S]*<text[\s\S]*<\/svg>$/);
  });

  test("every tool declares the domain unit contract and the new group", () => {
    for (const c of QUANTUM_GATES_CALCS) {
      expect(c.unitContract).toBe("domain");
      expect(c.group).toBe("Quantum computing");
    }
    expect(new Set(QUANTUM_GATES_CALCS.map((c) => c.id)).size).toBe(QUANTUM_GATES_CALCS.length);
  });
});
