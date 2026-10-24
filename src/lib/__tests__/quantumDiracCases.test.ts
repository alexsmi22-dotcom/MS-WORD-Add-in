// Release Q, parts Q1 + Q3 — the FIXED CASE TABLE for Dirac linear algebra, measurement, density matrices and bipartite
// entanglement, then oracle rows, adversarial and contract tests. The case-table oracle values were computed by the
// integrator (numpy, ~/jurislab-relE/oracle_quantum.py, sections Q1 and Q3). Every later fix round must keep every
// row's outcome (cumulative gate); reviewers add rows at the end of the table.
//
// Further reference values come from this oracle, run in C:\Users\AlexanderSmith\jurislab-oracle-venv (python -I):
//   import numpy as np, math
//   from scipy.linalg import sqrtm
//   s2=1/math.sqrt(2); I=np.eye(2); X=np.array([[0,1],[1,0]]); Y=np.array([[0,-1j],[1j,0]]); Z=np.diag([1.,-1])
//   k0=np.array([1,0]); k1=np.array([0,1]); kp=(k0+k1)*s2
//   psi=np.array([1,1j,-1])/math.sqrt(3); np.vdot([0,0,1],psi)              # -0.577350 (= −1/√3), |.|² 1/3
//   np.linalg.eigvalsh(np.kron(X,Z)+np.kron(Z,X))                          # −2, 0, 0, 2
//   mix=0.7*np.outer(k0,k0)+0.3*np.outer(kp,kp)
//   F=lambda r,s: np.real(np.trace(sqrtm(sqrtm(r)@s@sqrtm(r))))**2; F(mix,I/2)   # 0.824037
//   0.5*np.abs(np.linalg.eigvalsh(mix-I/2)).sum()                          # 0.380789
//   p=np.array([1,1,0,1])/math.sqrt(3); yp=(k0+1j*k1)*s2; v=np.kron(I,np.outer(yp,yp.conj()))@p
//   np.vdot(v,v).real                                                       # 0.5
//   st=np.array([0.3+0.1j,-0.5j,0.2,0.6-0.4j]); st/=np.linalg.norm(st)
//   2*abs(st[0]*st[3]-st[1]*st[2])                                          # 0.491444
//   np.linalg.svd(st.reshape(2,2),compute_uv=False)                         # 0.967189, 0.254058; E 0.345230
//   W=lambda p: p*np.outer(b,b)+(1-p)*np.eye(4)/4  (b = |Φ⁺⟩); PT spectrum at p=1: −0.5, 0.5, 0.5, 0.5
//   np.linalg.eigvals([[1,2],[0,3]]) -> 1, 3;  np.linalg.eigvals([[1,1j],[0,2j]]) -> 1, 2i
//   w=np.array([0.5,0.3,0.2]); -(w*np.log2(w)).sum()                       # 1.485475
//   W-state (|001⟩+|010⟩+|100⟩)/√3 split 1|2: Schmidt 0.816497, 0.577350, E 0.918296
import { QUANTUM_DIRAC_CALCS } from "../quantumDiracCalcs";
import type { AnalyzeOutput } from "../analyzeBlocks";
import {
  checkDensity,
  concurrence,
  densityOf,
  eigGeneral2,
  eigHermitian,
  eigNormal,
  fidelity,
  inner,
  measureObservable,
  negativity,
  outer,
  partialTrace,
  partialTranspose,
  readOperator,
  readState,
  schmidt,
  traceDistance,
  vonNeumannBits,
  wernerRho,
  withDegrees,
  bellDiagonalRho,
  DIRAC_MAX_DIM,
  registerWork,
} from "../quantumDirac";
import { GATES, cx, kron, matNear, matMul, matScale, type CMat } from "../quantumCore";
import { pureTwoQubit, wernerState } from "../quantum";
import { mathToOmml } from "../mathOmml";
import { mathToHtml } from "../mathHtml";

const calc = (id: string) => {
  const c = QUANTUM_DIRAC_CALCS.find((x) => x.id === id);
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
  if (o.ok === false) throw new Error(`refused: ${o.text}`);
  return o.text;
};
const refused = (o: AnalyzeOutput, re: RegExp): void => {
  expect(o.ok).toBe(false);
  expect(o.text).toMatch(re);
};
const op = (t: string): CMat => {
  const r = readOperator(t);
  if ("error" in r) throw new Error(r.error);
  return r.M;
};
const ROBERTSON_STATE = "cos(20°)|0⟩ + e^(i30°)*sin(20°)|1⟩";

describe("fixed case table (Release Q, parts Q1 + Q3)", () => {
  test("ψ = 0.6|0⟩ + 0.8i|1⟩, φ = |+⟩: ⟨φ|ψ⟩ = 0.424264 + 0.565685i (= (0.6 + 0.8i)/√2); |⟨φ|ψ⟩|² = 0.5", () => {
    const o = run("qc-dirac-states", { psi: "0.6|0⟩ + 0.8i|1⟩", phi: "|+⟩" });
    near(out(o, "ipRe"), 0.424264);
    near(out(o, "ipIm"), 0.565685);
    near(out(o, "overlap"), 0.5, 1e-12);
    expect(okText(o)).toContain("⟨φ|ψ⟩ = (0.6 + 0.8i)/√2 = 0.424264 + 0.565685i");
  });

  test("same ψ: ⟨X⟩ 0, ⟨Y⟩ 0.96, ⟨Z⟩ −0.28, Var Z 0.9216", () => {
    const st = "0.6|0⟩ + 0.8i|1⟩";
    near(out(run("qc-operators", { A: "X", state: st }), "expA"), 0, 1e-12);
    near(out(run("qc-operators", { A: "Y", state: st }), "expA"), 0.96, 1e-12);
    const z = run("qc-operators", { A: "Z", state: st });
    near(out(z, "expA"), -0.28, 1e-12);
    near(out(z, "varA"), 0.9216, 1e-12);
    expect(okText(z)).toContain("⟨A⟩ = −0.28");
  });

  test("[X, Y] = 2iZ", () => {
    const o = run("qc-operators", { A: "X", B: "Y" });
    expect(okText(o)).toContain("[A, B] = AB − BA = 2iZ");
    expect(o.blocks?.some((b) => b.kind === "math" && b.math === "[A, B] = A B - B A = 2 i Z")).toBe(true);
    expect(matNear(op("[X, Y]"), matScale(GATES.Z, cx(0, 2)), 1e-12)).toBe(true);
  });

  test("eigenvalues of [[2, 1−i], [1+i, 3]] are 1 and 4", () => {
    const o = run("qc-operators", { A: "[[2, 1-i], [1+i, 3]]" });
    near(out(o, "eig1Re"), 1, 1e-9);
    near(out(o, "eig2Re"), 4, 1e-9);
    expect(okText(o)).toContain("Eigenvalues (real, A is Hermitian): 1, 4.");
  });

  test("ψ = cos20°|0⟩ + e^{i30°} sin20°|1⟩: σX σY = 0.786659 ≥ 0.766044 (= |⟨Z⟩|)", () => {
    const o = run("qc-operators", { A: "X", B: "Y", state: ROBERTSON_STATE });
    near(out(o, "sigmaProduct"), 0.786659);
    near(out(o, "robertsonBound"), 0.766044);
    near(out(o, "robertsonBound"), Math.cos((40 * Math.PI) / 180), 1e-12);
    expect(okText(o)).toContain("σA σB = 0.786659 ≥ ½|⟨[A, B]⟩| = 0.766044");
    // The same state written with e^(i*30°) and in radians reads the same.
    const o2 = run("qc-operators", { A: "X", B: "Y", state: "cos(pi/9)|0⟩ + e^(i*pi/6)*sin(pi/9)|1⟩" });
    near(out(o2, "sigmaProduct"), out(o, "sigmaProduct"), 1e-12);
  });

  test("Bell |Φ⁺⟩ reduced state = I/2, entropy 1 bit", () => {
    const o = run("qc-bipartite", { mode: "pure", state: "|Φ⁺⟩", split: "1" });
    expect(okText(o)).toContain("ρ_A = tr_B |ψ⟩⟨ψ| = I/2 (maximally mixed)");
    near(out(o, "entropy"), 1, 1e-12);
    near(out(o, "purityA"), 0.5, 1e-12);
    // And through the density tool on the reduced state itself.
    const d = run("qc-density", { mode: "matrix", matrix: "0.5*I" });
    near(out(d, "entropy"), 1, 1e-12);
    expect(okText(d)).toContain("ρ = I/2: the maximally mixed state.");
  });

  test("mixture 0.7|0⟩⟨0| + 0.3|+⟩⟨+|: purity 0.79, entropy 0.527090 bits", () => {
    const o = run("qc-density", { mode: "mixture", mixture: "0.7: |0⟩\n0.3: |+⟩" });
    near(out(o, "purity"), 0.79, 1e-12);
    near(out(o, "entropy"), 0.52709, 5e-7);
    // The same ρ typed as an expression.
    const e = run("qc-density", { mode: "matrix", matrix: "0.7|0⟩⟨0| + 0.3|+⟩⟨+|" });
    near(out(e, "purity"), 0.79, 1e-12);
    near(out(e, "entropy"), out(o, "entropy"), 1e-12);
  });

  test("Werner p 0.6: concurrence 0.4, negativity 0.2, log-negativity 0.485427", () => {
    const o = run("qc-bipartite", { mode: "werner", p: "0.6" });
    near(out(o, "concurrence"), 0.4, 1e-9);
    near(out(o, "negativity"), 0.2, 1e-12);
    near(out(o, "logNegativity"), 0.485427);
    expect(okText(o)).toContain("ENTANGLED");
  });

  test("cos(π/8)|00⟩ + sin(π/8)|11⟩: Schmidt coefficients 0.923880, 0.382683", () => {
    const o = run("qc-bipartite", { mode: "pure", state: "cos(pi/8)|00⟩ + sin(pi/8)|11⟩", split: "1" });
    near(out(o, "schmidt1"), 0.92388, 5e-7);
    near(out(o, "schmidt2"), 0.382683, 5e-7);
  });

  test("fidelity and trace distance |0⟩ vs |+⟩: 0.5 and 0.707107", () => {
    const o = run("qc-density", { mode: "pure", state: "|0⟩", compare: "|+⟩" });
    near(out(o, "fidelity"), 0.5, 1e-12);
    near(out(o, "traceDistance"), 0.707107);
    expect(okText(o)).toContain("fidelity F = ½ = 0.5; trace distance T = 1/√2 = 0.707107");
  });

  test("non-Hermitian 'density matrix' or trace ≠ 1 beyond 1×10⁻⁹: named refusal", () => {
    refused(run("qc-density", { mode: "matrix", matrix: "[[0.5, 0.5], [0.2, 0.5]]" }), /not Hermitian/);
    refused(run("qc-density", { mode: "matrix", matrix: "[[0.6, 0], [0, 0.5]]" }), /tr ρ = 1\.1, not 1/);
    refused(run("qc-density", { mode: "matrix", matrix: "[[0.500000002, 0], [0, 0.5]]" }), /not 1 \(to within 1×10⁻⁹\)/);
    expect(run("qc-density", { mode: "matrix", matrix: "[[0.5000000004, 0], [0, 0.5]]" }).ok).not.toBe(false);
    refused(run("qc-bipartite", { mode: "mixed", matrix: "0.3*(I⊗I)" }), /tr ρ = 1\.2, not 1/);
  });

  test("mismatched dimensions in ⟨φ|ψ⟩: named refusal", () => {
    refused(run("qc-dirac-states", { psi: "|00⟩", phi: "|+⟩" }), /same space: \|φ⟩ has dimension 2 \(1 qubit\) and \|ψ⟩ has 4 \(2 qubits\)/);
  });
});

describe("oracle rows (numpy / scipy, script in the header)", () => {
  test("qutrit: ψ ∝ |0⟩ + i|1⟩ − |2⟩, φ = |2⟩ → ⟨φ|ψ⟩ = −1/√3, overlap ⅓", () => {
    const o = run("qc-dirac-states", { psi: "|0⟩ + i|1⟩ - |2⟩", phi: "|2⟩", dim: "3" });
    near(out(o, "ipRe"), -0.57735, 5e-7);
    near(out(o, "overlap"), 1 / 3, 1e-12);
    expect(okText(o)).toContain("normalised");
    expect(okText(o)).toContain("(|0⟩ + i|1⟩ − |2⟩)/√3");
  });

  test("eigenvalues of X⊗Z + Z⊗X: −2, 0, 0, 2 (degenerate 0 reported)", () => {
    const o = run("qc-operators", { A: "X⊗Z + Z⊗X" });
    [-2, 0, 0, 2].forEach((v, k) => near(out(o, `eig${k + 1}Re`), v, 1e-9));
    expect(okText(o)).toContain("λ = 0 (2-fold)");
  });

  test("F(0.7|0⟩⟨0| + 0.3|+⟩⟨+|, I/2) = 0.824037, T = 0.380789", () => {
    const o = run("qc-density", { compare: "0.5*I" });
    near(out(o, "fidelity"), 0.824037);
    near(out(o, "traceDistance"), 0.380789);
  });

  test("partial measurement: (|00⟩ + |01⟩ + |11⟩)/√3, qubit 1 in the Y basis → ½, ½", () => {
    const o = run("qc-measurement", { state: "|00⟩ + |01⟩ + |11⟩", qubit: "1", basis: "Y" });
    near(out(o, "p_pi"), 0.5, 1e-12);
    near(out(o, "p_mi"), 0.5, 1e-12);
    expect(okText(o)).toContain("whole register renormalised");
  });

  test("a complex two-qubit pure state: C 0.491444, Schmidt 0.967189 / 0.254058, E 0.345230", () => {
    const o = run("qc-bipartite", { state: "(0.3+0.1i)|00⟩ - 0.5i|01⟩ + 0.2|10⟩ + (0.6-0.4i)|11⟩" });
    near(out(o, "concurrence"), 0.491444);
    near(out(o, "schmidt1"), 0.967189);
    near(out(o, "schmidt2"), 0.254058);
    near(out(o, "entropy"), 0.34523, 5e-7);
  });

  test("W state split 1|2: Schmidt 0.816497, 0.577350, E 0.918296", () => {
    const o = run("qc-bipartite", { state: "|001⟩ + |010⟩ + |100⟩", split: "1" });
    near(out(o, "schmidt1"), 0.816497);
    near(out(o, "schmidt2"), 0.57735);
    near(out(o, "entropy"), 0.918296);
  });

  test("non-normal 2 × 2: eigenvalues of [[1, 2], [0, 3]] are 1, 3 and of [[1, i], [0, 2i]] are 1, 2i; no spectral decomposition", () => {
    const o = run("qc-operators", { A: "[[1, 2], [0, 3]]" });
    near(out(o, "eig1Re"), 1, 1e-12);
    near(out(o, "eig2Re"), 3, 1e-12);
    expect(okText(o)).toContain("NOT normal");
    const [a, b] = eigGeneral2(op("[[1, i], [0, 2i]]"));
    near(a.re, 0, 1e-12); near(a.im, 2, 1e-12);
    near(b.re, 1, 1e-12); near(b.im, 0, 1e-12);
  });

  test("entropy of diag(0.5, 0.3, 0.2) = 1.485475 bits", () => {
    const o = run("qc-density", { mode: "matrix", matrix: "[[0.5,0,0],[0,0.3,0],[0,0,0.2]]" });
    near(out(o, "entropy"), 1.485475);
  });

  test("Werner at p = 1/3 is PPT (separable), at p = 1 negativity ½ with PT spectrum −½, ½, ½, ½", () => {
    const sep = run("qc-bipartite", { mode: "werner", p: "1/3" });
    expect(okText(sep)).toContain("SEPARABLE");
    near(out(sep, "concurrence"), 0, 1e-12);
    near(out(sep, "negativity"), 0, 1e-12);
    const s2 = run("qc-bipartite", { mode: "werner", p: "0.2" });
    expect(okText(s2)).toContain("SEPARABLE");
    near(out(s2, "concurrence"), 0, 1e-12);
    const full = run("qc-bipartite", { mode: "werner", p: "1" });
    near(out(full, "negativity"), 0.5, 1e-12);
    near(out(full, "logNegativity"), 1, 1e-12);
  });
});

describe("engine", () => {
  test("eigHermitian rebuilds degenerate eigenspaces whole: I/2, the Werner ρ (0.1 ×3, 0.7), its partial transpose", () => {
    const e1 = eigHermitian(matScale(GATES.I, cx(0.5)));
    expect(e1?.values).toEqual([0.5, 0.5]);
    expect(e1?.clusters).toEqual([[0, 1]]);
    const w = eigHermitian(wernerRho(0.6))!;
    [0.1, 0.1, 0.1, 0.7].forEach((v, k) => near(w.values[k], v, 1e-12));
    expect(w.clusters.map((c) => c.length)).toEqual([3, 1]);
    // Orthonormal eigenvectors that really are eigenvectors.
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
      const ip = inner(w.vectors[a], w.vectors[b]);
      near(Math.hypot(ip.re - (a === b ? 1 : 0), ip.im), 0, 1e-10);
    }
    const pt = eigHermitian(partialTranspose(wernerRho(0.6), 2, 2))!;
    [-0.2, 0.4, 0.4, 0.4].forEach((v, k) => near(pt.values[k], v, 1e-12));
  });

  test("eigHermitian is scale-invariant (tiny and huge matrices are not left undiagonalised)", () => {
    for (const k of [1e-20, 1e-8, 1, 1e12]) {
      const e = eigHermitian(matScale(GATES.X, cx(k)))!;
      near(e.values[0] / k, -1, 1e-9);
      near(e.values[1] / k, 1, 1e-9);
    }
  });

  test("eigNormal: unitary T, S and H have eigenvalues on the unit circle and an orthonormal eigenbasis", () => {
    const t = eigNormal(GATES.T)!;
    near(t.values[0].re, Math.SQRT1_2, 1e-12); near(t.values[0].im, Math.SQRT1_2, 1e-12);
    near(t.values[1].re, 1, 1e-12);
    const h = eigNormal(GATES.H)!;
    near(h.values[0].re, -1, 1e-12); near(h.values[1].re, 1, 1e-12);
    // A degenerate Hermitian part with a non-trivial anti-Hermitian part: S ⊗ S† (eigenvalues 1, i, −i, 1).
    const ss = eigNormal(kron(GATES.S, GATES.Sdg))!;
    const im = ss.values.map((v) => Math.round(v.im)).sort();
    expect(im).toEqual([-1, 0, 0, 1]);
    for (let k = 0; k < 4; k++) {
      const Av = matMul(kron(GATES.S, GATES.Sdg), ss.vectors[k].map((z) => [z]));
      ss.vectors[k].forEach((z, i) => {
        const lz = { re: ss.values[k].re * z.re - ss.values[k].im * z.im, im: ss.values[k].re * z.im + ss.values[k].im * z.re };
        near(Av[i][0].re, lz.re, 1e-10); near(Av[i][0].im, lz.im, 1e-10);
      });
    }
  });

  test("Schmidt decomposition reconstructs ψ (2 × 2, 2 × 3, 2 × 4, a complex state)", () => {
    const cases: [string, string, number, number][] = [
      ["(0.3+0.1i)|00⟩ - 0.5i|01⟩ + 0.2|10⟩ + (0.6-0.4i)|11⟩", "", 2, 2],
      ["(1, 0.5i, -0.25, 0, 2, 1-i)", "6", 2, 3],
      ["|001⟩ + i|010⟩ + |100⟩ - 0.5|111⟩", "", 2, 4],
    ];
    for (const [text, dim, dA, dB] of cases) {
      const s = readState(text, dim);
      if ("error" in s) throw new Error(s.error);
      const sc = schmidt(s.state, dA, dB)!;
      near(sc.coeffs.reduce((t, x) => t + x * x, 0), 1, 1e-12);
      for (let i = 0; i < dA; i++) for (let j = 0; j < dB; j++) {
        let re = 0, im = 0;
        sc.coeffs.forEach((c, k) => {
          const a = sc.a[k][i], b = sc.b[k][j];
          re += c * (a.re * b.re - a.im * b.im);
          im += c * (a.re * b.im + a.im * b.re);
        });
        near(re, s.state[i * dB + j].re, 1e-10);
        near(im, s.state[i * dB + j].im, 1e-10);
      }
    }
  });

  test("Wootters concurrence = pureTwoQubit (quantum.ts) on pure states, and = wernerState on Werner states", () => {
    const states = ["|00⟩", "|Φ⁺⟩", "|Ψ⁻⟩", "(0.3+0.1i)|00⟩ - 0.5i|01⟩ + 0.2|10⟩ + (0.6-0.4i)|11⟩", "0.9|00⟩ + 0.1i|01⟩ + 0.3|10⟩ - 0.2|11⟩"];
    for (const t of states) {
      const s = readState(t);
      if ("error" in s) throw new Error(s.error);
      const w = concurrence(densityOf(s.state))!;
      const c = pureTwoQubit(s.state[0], s.state[1], s.state[2], s.state[3])!;
      near(w.c, c.concurrence, 1e-7);
    }
    for (let k = 0; k <= 20; k++) {
      const p = k / 20;
      near(concurrence(wernerRho(p))!.c, wernerState(p)!.concurrence, 1e-9);
    }
  });

  test("Bell-diagonal (0.7, 0.1, 0.1, 0.1): concurrence 2·0.7 − 1 = 0.4, negativity 0.2", () => {
    const rho = bellDiagonalRho([0.7, 0.1, 0.1, 0.1]);
    near(concurrence(rho)!.c, 0.4, 1e-9);
    near(negativity(rho, 2, 2)!.N, 0.2, 1e-12);
    const o = run("qc-bipartite", { mode: "belldiag", weights: "0.7, 0.1, 0.1, 0.1" });
    near(out(o, "concurrence"), 0.4, 1e-9);
  });

  test("partial trace and transpose on 2 × 3", () => {
    const s = readState("(1, 0, 0, 0, 0, 1)", "6");
    if ("error" in s) throw new Error(s.error);
    const rho = densityOf(s.state);
    const rA = partialTrace(rho, 2, 3, "A"), rB = partialTrace(rho, 2, 3, "B");
    near(rA[0][0].re, 0.5, 1e-12); near(rA[1][1].re, 0.5, 1e-12); near(rA[0][1].re, 0, 1e-12);
    near(rB[0][0].re, 0.5, 1e-12); near(rB[2][2].re, 0.5, 1e-12); near(rB[1][1].re, 0, 1e-12);
    const ng = negativity(rho, 2, 3)!;
    near(ng.N, 0.5, 1e-12);
    near(ng.logN, 1, 1e-12);
  });

  test("fidelity and trace distance: symmetric, 1 / 0 for equal states, mixed cases", () => {
    const a = densityOf(readStateOk("|0⟩")), b = densityOf(readStateOk("|+⟩"));
    near(fidelity(a, b)!, fidelity(b, a)!, 1e-12);
    near(fidelity(a, a)!, 1, 1e-10);
    near(traceDistance(a, a)!, 0, 1e-12);
    near(traceDistance(a, densityOf(readStateOk("|1⟩")))!, 1, 1e-12);
  });

  test("Lüders rule: Z⊗I on |Φ⁺⟩ keeps the whole eigenspace (post-states |00⟩ and |11⟩, each ½)", () => {
    const s = readStateOk("|Φ⁺⟩");
    const m = measureObservable(s, op("Z⊗I"));
    if ("error" in m) throw new Error(m.error);
    expect(m.outcomes.map((o) => Math.round(o.prob * 1e12) / 1e12)).toEqual([0.5, 0.5]);
    near(m.outcomes[0].post![3].re, 1, 1e-12); // λ = −1 → |11⟩
    near(m.outcomes[1].post![0].re, 1, 1e-12); // λ = +1 → |00⟩
    // A degenerate observable on a superposition inside one eigenspace leaves it untouched.
    const t = readStateOk("0.6|00⟩ + 0.8|01⟩");
    const m2 = measureObservable(t, op("Z⊗I"));
    if ("error" in m2) throw new Error(m2.error);
    const one = m2.outcomes.find((o) => o.prob > 0.5)!;
    near(one.post![0].re, 0.6, 1e-12);
    near(one.post![1].re, 0.8, 1e-12);
  });

  test("operator reader: expressions, matrices, ket-bras, daggers, brackets", () => {
    expect(matNear(op("0.5*(I + Z)"), [[cx(1), cx(0)], [cx(0), cx(0)]], 1e-12)).toBe(true);
    expect(matNear(op("(I+Z)/2"), op("|0⟩⟨0|"), 1e-12)).toBe(true);
    expect(matNear(op("H S H†"), matMul(matMul(GATES.H, GATES.S), GATES.H), 1e-12)).toBe(true);
    expect(matNear(op("S^†"), GATES.Sdg, 1e-12)).toBe(true);
    expect(matNear(op("S†"), GATES.Sdg, 1e-12)).toBe(true);
    expect(matNear(op("T^dagger"), GATES.Tdg, 1e-12)).toBe(true);
    expect(matNear(op("X ⊗ Z"), kron(GATES.X, GATES.Z), 1e-12)).toBe(true);
    expect(matNear(op("σx otimes σz"), kron(GATES.X, GATES.Z), 1e-12)).toBe(true);
    expect(matNear(op("{X, Y}"), [[cx(0), cx(0)], [cx(0), cx(0)]], 1e-12)).toBe(true);
    expect(matNear(op("2iZ"), matScale(GATES.Z, cx(0, 2)), 1e-12)).toBe(true);
    expect(matNear(op("e^(i*pi/4)*Z"), matScale(GATES.Z, cx(Math.SQRT1_2, Math.SQRT1_2)), 1e-12)).toBe(true);
    expect(matNear(op("Rz(90)"), op("[[e^(-i*pi/4), 0], [0, e^(i*pi/4)]]"), 1e-12)).toBe(true);
    expect(matNear(op("H^2"), GATES.I, 1e-12)).toBe(true);
    expect(matNear(op("CNOT"), op("|0⟩⟨0| ⊗ I + |1⟩⟨1| ⊗ X"), 1e-12)).toBe(true);
    expect(matNear(op("0 1\n1 0"), GATES.X, 1e-12)).toBe(true);
    expect(matNear(op("0, 1; 1, 0"), GATES.X, 1e-12)).toBe(true);
    expect(op("[[0.5,0,0],[0,0.3,0],[0,0,0.2]]").length).toBe(3);
  });

  test("operator reader refusals are named", () => {
    const err = (t: string): string => {
      const r = readOperator(t);
      if (!("error" in r)) throw new Error(`accepted: ${t}`);
      return r.error;
    };
    expect(err("XZ")).toMatch(/"XZ" is not an operator this reader knows/);
    expect(err("X + I⊗I")).toMatch(/sizes differ/);
    expect(err("X * CNOT")).toMatch(/sizes differ \(did you mean ⊗\?\)/);
    expect(err("0.5 + Z")).toMatch(/number and an operator cannot be added/);
    expect(err("2")).toMatch(/number, not an operator/);
    expect(err("X⊗X⊗X⊗X⊗X")).toMatch(/32 × 32; operators are limited to 16 × 16/);
    expect(err("[[1, 2], [3]]")).toMatch(/not square/);
    expect(err("[[1, inf], [0, 1]]")).toMatch(/not a finite number/);
    expect(err("|0⟩")).toMatch(/state, not an operator/);
    expect(err("X / Z")).toMatch(/Division is by a number only/);
    expect(err("X^0.5")).toMatch(/whole number from 0 to 64/);
    expect(err("(X")).toMatch(/Expected "\)"/);
    expect(err("[[5 kg, 0], [0, 1]]")).toMatch(/Row 1, column 1/);
    expect(err("")).toMatch(/No operator/);
  });

  test("state reader: d-level labels, amplitude lists, degrees, refusals", () => {
    const q = readState("|0⟩ + |2⟩", "3");
    if ("error" in q) throw new Error(q.error);
    expect(q.dim).toBe(3);
    near(q.state[2].re, Math.SQRT1_2, 1e-12);
    const e = (t: string, d = ""): string => {
      const r = readState(t, d);
      if (!("error" in r)) throw new Error(`accepted: ${t}`);
      return r.error;
    };
    expect(e("|3⟩", "3")).toMatch(/not a level of a 3-level system \(levels 0 to 2\)/);
    expect(e("|+⟩", "3")).toMatch(/3-level state is written with the level numbers/);
    expect(e("|0⟩", "17")).toMatch(/from 2 to 16/);
    expect(e("|0⟩", "two")).toMatch(/"auto" \(qubits\) or a whole number/);
    expect(e("(1, 2)", "3")).toMatch(/2 entries but the dimension is 3/);
    expect(e("(0, 0)")).toMatch(/zero/);
    expect(e("5 kg|0⟩")).toMatch(/coefficient of \|0⟩/);
    expect(e("NaN|0⟩")).toMatch(/not a finite number/);
    expect(e("|00000000000⟩")).toMatch(/limited to 10 qubits/);
    expect(e("")).toMatch(/No state was typed/);
    expect(withDegrees("e^(i30°)")).toBe("e^(i*(30*pi/180))");
    expect(withDegrees("cos(20°)")).toBe("cos((20*pi/180))");
  });

  test("density checks: negative eigenvalue refused; rounding noise clamped", () => {
    const r = checkDensity(op("[[1.2, 0], [0, -0.2]]"));
    expect("error" in r && r.error).toMatch(/negative eigenvalue \(−0\.2\)/);
    const ok = checkDensity(op("[[1, 0], [0, 0]]"));
    if ("error" in ok) throw new Error(ok.error);
    expect(vonNeumannBits(ok.probs)).toBe(0);
  });

  test("bipartite routines refuse non-finite or mismatched dimensions by throwing, never by looping (fuzz finding)", () => {
    const rho = wernerRho(0.5);
    expect(() => partialTranspose(rho, Infinity, 2)).toThrow(/d_A × d_B/);
    expect(() => partialTrace(rho, 2, NaN, "A")).toThrow(/d_A × d_B/);
    expect(() => negativity(rho, 2, 3)).toThrow(/d_A × d_B/);
    expect(() => schmidt(readStateOk("|00⟩"), 1e9, 1)).toThrow(/d_A × d_B/);
  });

  test("outer product |ψ⟩⟨φ| is ψᵢ φⱼ*", () => {
    const o = outer(readStateOk("0.6|0⟩ + 0.8i|1⟩"), readStateOk("|i⟩"));
    // φ = (1, i)/√2, so φ* = (1, −i)/√2: entry (1, 1) = 0.8i·(−i)/√2 = 0.8/√2.
    near(o[1][1].re, 0.8 * Math.SQRT1_2, 1e-12);
    near(o[1][1].im, 0, 1e-12);
  });
});

function readStateOk(t: string, d = "") {
  const s = readState(t, d);
  if ("error" in s) throw new Error(s.error);
  return s.state;
}

describe("tool refusals and caps", () => {
  test("named refusals across the tools", () => {
    refused(run("qc-dirac-states", { psi: "" }), /No state was typed/);
    refused(run("qc-operators", { A: "X", B: "I⊗I" }), /same space/);
    refused(run("qc-operators", { A: "X", state: "|00⟩" }), /dimension 4 but the operator is 2 × 2/);
    refused(run("qc-measurement", { state: "|0⟩", basis: "bell" }), /Bell basis is a basis of TWO qubits/);
    refused(run("qc-measurement", { state: "|00⟩", qubit: "2" }), /from 0 to 1/);
    refused(run("qc-measurement", { state: "|00⟩", qubit: "0", basis: "bell" }), /computational, X or Y basis/);
    refused(run("qc-measurement", { basis: "typed", set: "|0⟩\n|+⟩" }), /not orthonormal: ⟨0\|\+⟩ = 0\.707107, not 0/);
    refused(run("qc-measurement", { basis: "typed", set: "|0⟩\n|1⟩\n|+⟩" }), /at most 2 can be orthonormal/);
    refused(run("qc-measurement", { basis: "observable", obs: "[[0, 1], [0, 0]]" }), /observable must be Hermitian/);
    refused(run("qc-measurement", { basis: "observable", obs: "X⊗X" }), /4 × 4 but the state has dimension 2/);
    refused(run("qc-density", { mode: "mixture", mixture: "0.7: |0⟩\n0.2: |1⟩" }), /weights sum to 0\.9, not 1/);
    refused(run("qc-density", { mode: "mixture", mixture: "1.2: |0⟩\n-0.2: |1⟩" }), /negative/);
    refused(run("qc-density", { mode: "mixture", mixture: "0.5: |0⟩\n0.5: |00⟩" }), /dimension 4 but an earlier one has 2/);
    refused(run("qc-density", { mode: "mixture", mixture: "0.5 |0⟩" }), /'weight: state'/);
    refused(run("qc-density", { mode: "pure", state: "|00000⟩" }), /limited to 16 × 16 \(4 qubits\)/);
    refused(run("qc-density", { compare: "|00⟩" }), /dimension 4 but ρ is 2 × 2/);
    refused(run("qc-bipartite", { state: "|000⟩", split: "3" }), /from 1 to 2 of the 3 qubits/);
    refused(run("qc-bipartite", { state: "|000⟩", split: "2x3" }), /2 × 3 = 6, but the state has dimension 8/);
    refused(run("qc-bipartite", { state: "|00000⟩" }), /limited to dimension 16/);
    refused(run("qc-bipartite", { mode: "werner", p: "1.5" }), /from 0 to 1/);
    refused(run("qc-bipartite", { mode: "belldiag", weights: "0.5, 0.5, 0.5" }), /exactly four numbers/);
    refused(run("qc-bipartite", { mode: "belldiag", weights: "0.6, 0.6, -0.1, -0.1" }), /none may be negative/);
    refused(run("qc-bipartite", { mode: "mixed", matrix: "0.125*(I⊗I⊗I)", split: "" }), /Give the split/);
  });

  test("the size caps compute (16 × 16 operator, 4-qubit density matrix, 10-qubit register measured): bounded work", () => {
    expect(run("qc-operators", { A: "X⊗Y⊗Z⊗H + 0.5*(Z⊗Z⊗I⊗I)", state: "|0000⟩ + |1111⟩" }).ok).not.toBe(false);
    expect(run("qc-density", { mode: "pure", state: "|0000⟩ + i|1010⟩ - |1111⟩", compare: "0.0625*(I⊗I⊗I⊗I)" }).ok).not.toBe(false);
    expect(run("qc-bipartite", { mode: "mixed", matrix: "0.0625*(I⊗I⊗I⊗I)", split: "2" }).ok).not.toBe(false);
    // Work bound, deterministic: the 10-qubit X-basis measurement builds NO basis vectors (512 possible outcomes is
    // past the 64 post-states it ever writes out) — it rotates the state, O(n·2ⁿ), instead of comparing 2ⁿ vectors.
    registerWork.basisVectorsBuilt = 0;
    const big = run("qc-measurement", { state: "|0000000000⟩ + |1111111111⟩", basis: "X" });
    expect(big.ok).not.toBe(false);
    expect(registerWork.basisVectorsBuilt).toBe(0);
    expect(okText(big)).toContain("The table lists 64 of the 512 possible outcomes (512 outcomes have probability 0)");
    registerWork.basisVectorsBuilt = 0;
    run("qc-measurement", { state: "|000⟩ + |111⟩", basis: "X" });
    expect(registerWork.basisVectorsBuilt).toBe(4);
    refused(run("qc-measurement", { state: "|00000⟩", basis: "typed", set: Array.from({ length: 17 }, (_, k) => `|${k.toString(2).padStart(5, "0")}⟩`).join("\n") }), /at most 16 vectors/);
    near(out(big, "p_pppppppppp"), 1 / 512, 1e-12);
    const st = run("qc-dirac-states", { psi: "|0000000000⟩ + |1111111111⟩", phi: "|0000000000⟩" });
    expect(okText(st)).toContain("tabulated only up to 16 × 16");
    expect(DIRAC_MAX_DIM).toBe(16);
  });
});

describe("display contract, math lines and figures", () => {
  const VARIANTS: [string, Record<string, string>][] = [
    ["qc-dirac-states", {}],
    ["qc-dirac-states", { psi: "|0⟩ + i|1⟩ - |2⟩", phi: "|2⟩", dim: "3" }],
    ["qc-dirac-states", { psi: "|Φ⁺⟩", phi: "|Ψ⁻⟩" }],
    ["qc-operators", {}],
    ["qc-operators", { A: "X", B: "Y", state: ROBERTSON_STATE }],
    ["qc-operators", { A: "T", state: "|+⟩" }],
    ["qc-operators", { A: "[[1, 2], [0, 3]]" }],
    ["qc-operators", { A: "X⊗Z + Z⊗X", B: "Z⊗Z", state: "|Φ⁺⟩" }],
    ["qc-measurement", {}],
    ["qc-measurement", { state: "|Φ⁺⟩", basis: "bell" }],
    ["qc-measurement", { state: "|000⟩ + |111⟩", basis: "X" }],
    ["qc-measurement", { basis: "typed", set: "|i⟩\n|−i⟩" }],
    ["qc-measurement", { basis: "typed", set: "|+⟩" }],
    ["qc-measurement", { basis: "observable", obs: "0.5*(I + X)" }],
    ["qc-measurement", { state: "|0⟩ + |1⟩ + |2⟩", dim: "3", basis: "typed", set: "|0⟩\n|1⟩\n|2⟩" }],
    ["qc-density", {}],
    ["qc-density", { mode: "pure", state: "|0⟩", compare: "|+⟩" }],
    ["qc-density", { mode: "matrix", matrix: "0.25*(I⊗I)" }],
    ["qc-density", { mode: "matrix", matrix: "[[0.5,0,0],[0,0.3,0],[0,0,0.2]]" }],
    ["qc-bipartite", {}],
    ["qc-bipartite", { state: "|01⟩" }],
    ["qc-bipartite", { mode: "werner" }],
    ["qc-bipartite", { mode: "werner", p: "0.2" }],
    ["qc-bipartite", { mode: "belldiag" }],
    ["qc-bipartite", { mode: "mixed" }],
    ["qc-bipartite", { mode: "mixed", matrix: "[[0.5,0,0,0,0,0.5],[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0],[0.5,0,0,0,0,0.5]]", split: "2x3" }],
    ["qc-bipartite", { mode: "mixed", matrix: "0.0625*(I⊗I⊗I⊗I)", split: "2" }],
  ];
  const runs = VARIANTS.map(([id, o]) => [`${id} ${JSON.stringify(o)}`, run(id, o)] as const);

  test.each(runs)("%s: ok, no caret / e-notation / NaN / em dash / hyphen-minus; outputs; math parses; a figure", (_n, o) => {
    const t = okText(o);
    expect(t).not.toMatch(/\^|NaN|Infinity|undefined|—/);
    expect(t).not.toMatch(/\d[eE][+-]?\d/);
    expect(t).not.toMatch(/(^|[\s(=,;:[/])-\d/m);
    expect((o.outputs ?? []).length).toBeGreaterThan(0);
    for (const v of o.outputs ?? []) expect(Number.isFinite(v.value)).toBe(true);
    const keys = (o.outputs ?? []).map((v) => v.key);
    expect(new Set(keys).size).toBe(keys.length);
    const blocks = o.blocks ?? [];
    for (const b of blocks) if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
    const plots = blocks.filter((b) => b.kind === "plot");
    expect(plots.length).toBeGreaterThan(0);
    for (const p of plots) if (p.kind === "plot") {
      expect(p.svg).toMatch(/^<svg[\s\S]*<text[\s\S]*<\/svg>$/);
      const texts = [...p.svg.matchAll(/>([^<>]+)<\/text>/g)].map((m) => m[1]).join(" | ");
      expect(texts).not.toMatch(/NaN|Infinity|undefined|\^|\d[eE][+-]?\d|(^|[\s(])-\d/);
    }
    for (const b of blocks) if (b.kind === "table") for (const row of b.rows) for (const c of row) expect(c).not.toMatch(/NaN|\^|(^|\s)-\d/);
  });

  test("every tool declares the 'domain' unit contract and a unique id", () => {
    expect(QUANTUM_DIRAC_CALCS.map((c) => c.unitContract)).toEqual(["domain", "domain", "domain", "domain", "domain"]);
    expect(new Set(QUANTUM_DIRAC_CALCS.map((c) => c.id)).size).toBe(5);
    expect(QUANTUM_DIRAC_CALCS.every((c) => c.group === "Quantum computing")).toBe(true);
  });
});

describe("the equation typesetter: Dirac symbols (granted mathParse / mathOmml / mathHtml change)", () => {
  // Each new form round-trips through BOTH emitters as structure (mathToHtml never throws: it falls back to plain text,
  // so the structured markers are asserted, not just the absence of an error).
  const FORMS: [string, RegExp, RegExp][] = [
    ["ket(+)", /<m:begChr m:val="\|"\/><m:endChr m:val="⟩"\/><\/m:dPr><m:e><m:r><m:rPr><m:sty m:val="p"\/><\/m:rPr><m:t xml:space="preserve">\+<\/m:t>/, /^\|\+⟩$/],
    ["ket(-)", /<m:t xml:space="preserve">−<\/m:t>/, /^\|−⟩$/],
    ["bra(-)", /<m:begChr m:val="⟨"\/><m:endChr m:val="\|"\/>[\s\S]*−/, /^⟨−\|$/],
    ["bra(+)", /<m:begChr m:val="⟨"\/>[\s\S]*\+/, /^⟨\+\|$/],
    ["ket(i)", /<m:t xml:space="preserve">i<\/m:t>/, /^\|i⟩$/],
    ["ket(-i)", /−<\/m:t>[\s\S]*i<\/m:t>/, /^\|−i⟩$/],
    ["ket(Phi^+)", /<m:sSup><m:e><m:r><m:t xml:space="preserve">Φ<\/m:t><\/m:r><\/m:e><m:sup>[\s\S]*\+/, /^\|Φ<sup>\+<\/sup>⟩$/],
    ["ket(Phi^-)", /<m:sSup>[\s\S]*Φ[\s\S]*<m:sup>[\s\S]*−/, /^\|Φ<sup>−<\/sup>⟩$/],
    ["ket(Psi+)", /<m:sSup>[\s\S]*Ψ[\s\S]*\+/, /^\|Ψ<sup>\+<\/sup>⟩$/],
    ["bra(Psi-)", /<m:sSup>[\s\S]*Ψ[\s\S]*−/, /^⟨Ψ<sup>−<\/sup>\|$/],
    ["ket(Φ⁺)", /<m:sSup>[\s\S]*Φ[\s\S]*\+/, /^\|Φ<sup>\+<\/sup>⟩$/],
    ["ket(Ψ⁻)", /<m:sSup>[\s\S]*Ψ[\s\S]*−/, /^\|Ψ<sup>−<\/sup>⟩$/],
    ["braket(+, -)", /<m:begChr m:val="⟨"\/><m:endChr m:val="⟩"\/>/, /^⟨\+\|−⟩$/],
    ["U^dagger", /<m:sSup><m:e><m:r><m:t xml:space="preserve">U<\/m:t><\/m:r><\/m:e><m:sup><m:r><m:t xml:space="preserve">†<\/m:t>/, /^U<sup>†<\/sup>$/],
    ["U†", /<m:sSup>[\s\S]*U[\s\S]*<m:sup>[\s\S]*†/, /^U<sup>†<\/sup>$/],
    ["A^†", /<m:sSup>[\s\S]*A[\s\S]*†/, /^A<sup>†<\/sup>$/],
    ["X ⊗ Z", /⊗/, /^X<span class="m-op">⊗<\/span>Z$/],
    ["ket(0) otimes ket(1)", /⊗/, /^\|0⟩<span class="m-op">⊗<\/span>\|1⟩$/],
  ];
  test.each(FORMS)("%s round-trips through mathToOmml and mathToHtml", (src, omml, html) => {
    const o = mathToOmml(src);
    expect(o).toMatch(omml);
    expect(o).not.toMatch(/dagger/);
    expect(mathToHtml(src)).toMatch(html);
  });

  test("a sign used as a label carries no operator spacing; existing forms are unchanged", () => {
    expect(mathToHtml("ket(+)")).not.toMatch(/m-op/);
    expect(mathToHtml("a + b")).toContain('<span class="m-op">+</span>');
    expect(mathToHtml("x^-y")).toBe("x<sup><span class=\"m-op\">−</span>y</sup>");
    expect(mathToHtml("ket(psi)")).toBe("|ψ⟩");
    expect(mathToHtml("braket(φ, ψ)")).toBe("⟨φ|ψ⟩");
  });

  test("every math line the five tools emit typesets as structure (no plain-text fallback)", () => {
    for (const c of QUANTUM_DIRAC_CALCS) {
      const o = run(c.id);
      for (const b of o.blocks ?? []) if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
    }
  });
});
