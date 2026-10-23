// Release E, E3-a (gap #2): controlled sources (E, G, H, F) and coupled inductors (K) in the
// circuit MNA, DC + AC + transient. The FIXED CASE TABLE of the brief, then rows checked
// against an INDEPENDENT numpy MNA, then the refusals. Every later fix round must keep every
// row's outcome (cumulative gate).
//
// ORACLE 1, the integrator's (~/jurislab-relE/oracle_e3.py, closed forms):
//   noninverting gain A/(1 + Aβ), A = 10⁶, β = 0.1 -> 9.99990000099999
//   coupled L (mesh equations, dots at the first nodes) -> |V2| 1.9799997523598918, −0.02865599761064829°
//   hybrid-π CE -gm RC -> −200
//
// ORACLE 2, an independent numpy MNA written apart from circuit.ts (every inductor gets a
// branch current; K stamps −jωM between the two inductor rows), run in
// C:\Users\AlexanderSmith\jurislab-oracle-venv:
//
//   import numpy as np, math
//   from scipy.integrate import solve_ivp
//   def mna(lines, f=0.0):
//       w = 2*math.pi*f
//       els = [l.split() for l in lines.strip().splitlines()]
//       nodes = []
//       for e in els:
//           k = e[0][0].upper(); ns = e[1:3] if k != 'K' else []
//           if k in 'EG': ns = e[1:5]
//           for n in ns:
//               if n != '0' and n not in nodes: nodes.append(n)
//       br = [e[0] for e in els if e[0][0].upper() in 'VEHL']
//       N = len(nodes) + len(br); A = np.zeros((N, N), complex); b = np.zeros(N, complex)
//       ni = lambda n: None if n == '0' else nodes.index(n)
//       bi = lambda name: len(nodes) + br.index(name)
//       val = {e[0]: float(e[-1].replace('meg','e6').replace('k','e3').replace('m','e-3')
//                          .replace('u','e-6').replace('n','e-9')) for e in els}
//       def add(i, j, v):
//           if i is not None and j is not None: A[i, j] += v
//       for e in els:
//           k = e[0][0].upper(); v = val[e[0]]
//           if k in 'RC':
//               y = 1/v if k == 'R' else 1j*w*v; a, c = ni(e[1]), ni(e[2])
//               add(a, a, y); add(c, c, y); add(a, c, -y); add(c, a, -y)
//           elif k == 'I':
//               a, c = ni(e[1]), ni(e[2])
//               if a is not None: b[a] -= v
//               if c is not None: b[c] += v
//           elif k == 'G':
//               a, c, p, q = (ni(x) for x in e[1:5]); add(a, p, v); add(a, q, -v); add(c, p, -v); add(c, q, v)
//           elif k == 'F':
//               a, c = ni(e[1]), ni(e[2]); j = bi(e[3]); add(a, j, v); add(c, j, -v)
//           if k in 'VEHL':
//               r = bi(e[0]); a, c = ni(e[1]), ni(e[2])
//               add(r, a, 1); add(a, r, 1); add(r, c, -1); add(c, r, -1)
//               if k == 'V': b[r] = v
//               if k == 'E': add(r, ni(e[3]), -v); add(r, ni(e[4]), v)
//               if k == 'H': A[r, bi(e[3])] -= v
//               if k == 'L': A[r, r] -= 1j*w*v
//       for e in els:
//           if e[0][0].upper() == 'K':
//               M = val[e[0]]*math.sqrt(val[e[1]]*val[e[2]]); p, q = bi(e[1]), bi(e[2])
//               A[p, q] -= 1j*w*M; A[q, p] -= 1j*w*M
//       x = np.linalg.solve(A, b)
//       return {n: x[i] for i, n in enumerate(nodes)}, {nm: x[len(nodes)+i] for i, nm in enumerate(br)}
//   # rows below print abs, degrees, re, im of the node named in each test.
//   # Transient: the k = 0.999 transformer from rest, (i1, i2) entering each first node,
//   #   [L1 M; M L2] d/dt [i1; i2] = [sin(wt) − Rs i1; −RL i2], v2 = −RL i2   (Radau, rtol 1e−10)
//   L1, L2, k, Rs, RL = 1e-3, 4e-3, 0.999, 1.0, 1e3
//   M = k*math.sqrt(L1*L2); Li = np.linalg.inv(np.array([[L1, M], [M, L2]])); w = 2*math.pi*1e3
//   sol = solve_ivp(lambda t, y: Li @ np.array([math.sin(w*t) - Rs*y[0], -RL*y[1]]), (0, 10e-3), [0, 0],
//                   method='Radau', rtol=1e-10, atol=1e-13, dense_output=True)
//   for t in (0.25e-3, 1.1e-3, 9.6e-3, 9.85e-3): print(-RL*sol.sol(t)[1])
//   # -> 1.7013839956636803 1.2870588058625343 −1.3899662675021272 −1.3897272692389018

import { parseNetlist, solveDc, solveAc, frequencySweep, Element, COUPLING_NOTE, CONTROLLED_NOTE } from "../circuit";
import { solveTransient, traceAt, TransientOk } from "../circuitTransient";
import { CIRCUIT_CALCS } from "../circuitCalcs";
import type { AnalyzeOutput } from "../analyzeBlocks";

const calc = CIRCUIT_CALCS[0];

function net(text: string): Element[] {
  const p = parseNetlist(text);
  if (p.errors.length) throw new Error(`netlist errors: ${p.errors.join(" | ")}`);
  return p.elements;
}
function parseErr(text: string): string {
  const p = parseNetlist(text);
  expect(p.errors.length).toBeGreaterThan(0);
  return p.errors.join(" | ");
}
function dc(text: string): Extract<ReturnType<typeof solveDc>, { ok: true }> {
  const r = solveDc(net(text));
  if (!r.ok) throw new Error(r.error);
  return r;
}
function ac(text: string, f: number): Extract<ReturnType<typeof solveAc>, { ok: true }> {
  const r = solveAc(net(text), f);
  if (!r.ok) throw new Error(r.error);
  return r;
}
function tran(text: string, req: Parameters<typeof solveTransient>[1]): TransientOk {
  const r = solveTransient(net(text), req);
  if (!r.ok) throw new Error(`expected a run, got: ${r.error}`);
  return r;
}
const node = <T extends { name: string }>(list: T[], name: string): T => {
  const hit = list.find((x) => x.name === name);
  if (!hit) throw new Error(`no node ${name}`);
  return hit;
};
const probe = (r: TransientOk, name: string): Float64Array => {
  const p = r.probes.find((x) => x.name === name);
  if (!p) throw new Error(`no probe ${name}`);
  return p.values;
};
function run(over: Record<string, string>): AnalyzeOutput {
  const v: Record<string, string> = Object.fromEntries(calc.fields.map((f) => [f.key, f.default]));
  Object.assign(v, over);
  return calc.compute((k) => v[k] ?? "");
}
function contractClean(text: string): void {
  expect(text).not.toMatch(/\d[eE][+-]?\d/);
  expect(text).not.toMatch(/NaN|Infinity|undefined/);
  expect(text).not.toContain("—");
  expect(text).not.toContain("^");
  expect(text).not.toMatch(/(^|[\s(=:,])-\d/m);
}
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

const NONINV = "V1 1 0 1\nE1 out 0 1 2 1meg\nR1 2 0 1k\nR2 out 2 9k";
const XFMR = "V1 1 0 1\nL1 1 0 1m\nL2 2 0 4m\nK1 L1 L2 0.99\nRL 2 0 1k";
const CE = "V1 b 0 1m\nRpi b 0 2.5k\nG1 c 0 b 0 40m\nRC c 0 5k";
const XFMR_TRAN = "V1 1 0 SIN(0 1 1k)\nRs 1 3 1\nL1 3 0 1m\nL2 2 0 4m\nK1 L1 L2 0.999\nRL 2 0 1k";

describe("fixed case table (brief E3-a)", () => {
  test("1 non-inverting amplifier, VCVS A = 1×10⁶, R1 1 kΩ, R2 9 kΩ → gain 9.99990000099999 (exact 1000000/100001)", () => {
    const r = dc(NONINV);
    const out = node(r.nodes, "out");
    expect(out.volts).toBe(9.99990000099999);
    expect(out.exact).toEqual({ n: 1000000n, d: 100001n });
    expect(r.exact).toBe(true);
    // Tellegen: the E source delivers exactly what R1 and R2 dissipate.
    expect(Math.abs(r.totalDelivered - r.totalDissipated)).toBeLessThan(1e-15);
    expect(r.power.find((p) => p.name === "E1")?.watts).toBeLessThan(0);
    expect(r.notes).toContain(CONTROLLED_NOTE);
    // The AC path agrees at any frequency (a resistive circuit).
    expect(rel(node(ac(NONINV, 1000).nodes, "out").magnitude, 9.99990000099999)).toBeLessThan(1e-12);
  });

  test("2 coupled inductors 1 mH / 4 mH, k 0.99, 1 V 1 kHz on L1, 1 kΩ on L2 → |V₂| 1.97999975 V at −0.028656° (dots at the first nodes)", () => {
    const r = ac(XFMR, 1000);
    const v2 = node(r.nodes, "2");
    expect(v2.magnitude).toBeCloseTo(1.97999975, 8);
    expect(v2.phaseDeg).toBeCloseTo(-0.028656, 6);
    // numpy MNA and the mesh closed form: 1.9799997523598918 at −0.02865599761064841°
    expect(rel(v2.magnitude, 1.9799997523598918)).toBeLessThan(1e-12);
    expect(Math.abs(v2.phaseDeg - -0.02865599761064841)).toBeLessThan(1e-10);
    expect(r.notes).toContain(COUPLING_NOTE);
    expect(COUPLING_NOTE).toMatch(/dot at each inductor's FIRST node/);
    // Reversing L2's nodes moves its dot: the same magnitude, 180° away (numpy: 179.97134400238934°).
    const rev = node(ac(XFMR.replace("L2 2 0 4m", "L2 0 2 4m"), 1000).nodes, "2");
    expect(rel(rev.magnitude, 1.9799997523598918)).toBeLessThan(1e-12);
    expect(Math.abs(rev.phaseDeg - 179.97134400238934)).toBeLessThan(1e-9);
  });

  test("3 hybrid-π CE stage, gm 40 mS (VCCS), RC 5 kΩ → gain −200 (exact in DC, 180° in AC)", () => {
    const r = dc(CE);
    expect(node(r.nodes, "c").exact).toEqual({ n: -1n, d: 5n });
    expect(node(r.nodes, "c").volts / node(r.nodes, "b").volts).toBe(-200);
    const a = ac(CE, 10e3);
    const c = node(a.nodes, "c");
    expect(c.re / node(a.nodes, "b").re).toBeCloseTo(-200, 12);
    expect(Math.abs(c.phaseDeg)).toBeCloseTo(180, 12);
    expect(Math.abs(r.totalDelivered - r.totalDissipated)).toBeLessThan(1e-18);
  });

  test("4 transient: a k 0.999 transformer driven by a 1 kHz sine reproduces the AC phasor at steady state within 1 %", () => {
    const phasor = node(ac(XFMR_TRAN.replace("SIN(0 1 1k)", "1"), 1000).nodes, "2");
    // numpy MNA: |V2| 1.9655129085926064 at 9.004827981130997°
    expect(rel(phasor.magnitude, 1.9655129085926064)).toBeLessThan(1e-12);
    expect(Math.abs(phasor.phaseDeg - 9.004827981130997)).toBeLessThan(1e-9);
    const r = tran(XFMR_TRAN, { stop: 10e-3, step: 1e-6 });
    const v = probe(r, "2");
    // Over the last full period (9–10 ms), point by point against |V| sin(ωt + φ): the
    // SIN source is the sine reference whose phasor is 1∠0°.
    const w = 2 * Math.PI * 1000;
    const phi = (phasor.phaseDeg * Math.PI) / 180;
    let worst = 0;
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = 0; i < r.times.length; i++) {
      const t = r.times[i];
      if (t < 9e-3) continue;
      worst = Math.max(worst, Math.abs(v[i] - phasor.magnitude * Math.sin(w * t + phi)));
      hi = Math.max(hi, v[i]);
      lo = Math.min(lo, v[i]);
    }
    expect(worst / phasor.magnitude).toBeLessThan(0.01);
    expect(rel((hi - lo) / 2, phasor.magnitude)).toBeLessThan(0.01);
    // and the whole run (start-up included) against the scipy Radau solution of the coupled ODE
    const ref: [number, number][] = [
      [0.25e-3, 1.7013839956636803],
      [1.1e-3, 1.2870588058625343],
      [9.6e-3, -1.3899662675021272],
      [9.85e-3, -1.3897272692389018],
    ];
    for (const [t, want] of ref) expect(Math.abs(traceAt(r.times, v, t) - want) / phasor.magnitude).toBeLessThan(0.005);
    const kNote = r.notes.find((x) => x.startsWith(COUPLING_NOTE));
    expect(kNote).toMatch(/leakage mode with a time constant of about L\(1 − k²\)\/R/);
  });

  test("5 CCVS against a hand-solved circuit: H1 = 500 Ω × I(Vs)", () => {
    // V1 10 V drives R1 1 kΩ into a 0 V sense source to ground, so I(Vs) = 10 V / 1 kΩ =
    // 10 mA (positive from Vs's + node 2 through it to ground). H1 sets V(3) = 500 Ω × 10 mA
    // = 5 V across R3 1 kΩ, which draws 5 mA, so I(H1) = −5 mA and H1 delivers 25 mW.
    const text = "V1 1 0 10\nR1 1 2 1k\nVs 2 0 0\nH1 3 0 Vs 500\nR3 3 0 1k";
    const r = dc(text);
    expect(node(r.nodes, "3").exact).toEqual({ n: 5n, d: 1n });
    expect(node(r.currents, "Vs").exact).toEqual({ n: 1n, d: 100n });
    expect(node(r.currents, "H1").exact).toEqual({ n: -1n, d: 200n });
    expect(node(r.power, "H1").watts).toBeCloseTo(-0.025, 15);
    // AC (resistive, so the same) and transient (flat at 5 V from t = 0)
    expect(node(ac(text, 50).nodes, "3").re).toBeCloseTo(5, 12);
    const t = tran(text, { stop: 1e-3 });
    for (const x of probe(t, "3")) expect(Math.abs(x - 5)).toBeLessThan(1e-12);
  });

  test("6 CCCS against a hand-solved circuit: F1 = 50 × I(Vs)", () => {
    // I(Vs) = 10 mA as above. F1 0 3 Vs 50 drives 50 × 10 mA = 0.5 A from node 0 through
    // the source to node 3, i.e. INTO node 3, so V(3) = 0.5 A × 100 Ω = 50 V, and F1
    // delivers 0.5 A × 50 V = 25 W.
    const text = "V1 1 0 10\nR1 1 2 1k\nVs 2 0 0\nF1 0 3 Vs 50\nR3 3 0 100";
    const r = dc(text);
    expect(node(r.nodes, "3").exact).toEqual({ n: 50n, d: 1n });
    expect(node(r.currents, "F1").exact).toEqual({ n: 1n, d: 2n });
    expect(node(r.power, "F1").watts).toBe(-25);
    expect(r.totalDelivered).toBeCloseTo(r.totalDissipated, 12);
    expect(node(ac(text, 50).nodes, "3").re).toBeCloseTo(50, 10);
    const t = tran(text, { stop: 1e-3 });
    for (const x of probe(t, "3")) expect(Math.abs(x - 50)).toBeLessThan(1e-10);
  });
});

describe("two-node hand-solved CCVS and CCCS (the brief's form), sensing the driving source itself", () => {
  // V1 10 V across R1 1 kΩ delivers 10 mA, so I(V1) = −10 mA: SPICE's I(V) runs from the +
  // node THROUGH the source to the − node, which for a source delivering power is negative.
  test("CCVS: H1 2 0 V1 500 → V(2) = 500 Ω × (−10 mA) = −5 V (numpy MNA −5.0)", () => {
    const text = ["V1 1 0 10", "R1 1 0 1k", "H1 2 0 V1 500", "R2 2 0 1k"].join("\n");
    const r = dc(text);
    expect(node(r.currents, "V1").exact).toEqual({ n: -1n, d: 100n });
    expect(node(r.nodes, "2").exact).toEqual({ n: -5n, d: 1n });
    expect(node(ac(text, 1000).nodes, "2").re).toBeCloseTo(-5, 12);
  });
  test("CCCS: F1 0 2 V1 50 → 50 × (−10 mA) = −0.5 A into node 2, V(2) = −50 V (numpy MNA −50.0)", () => {
    const text = ["V1 1 0 10", "R1 1 0 1k", "F1 0 2 V1 50", "R2 2 0 100"].join("\n");
    const r = dc(text);
    expect(node(r.nodes, "2").exact).toEqual({ n: -50n, d: 1n });
    expect(node(r.currents, "F1").exact).toEqual({ n: -1n, d: 2n });
    expect(r.totalDelivered).toBeCloseTo(r.totalDissipated, 12);
    expect(node(ac(text, 1000).nodes, "2").re).toBeCloseTo(-50, 10);
  });
});

describe("work bounds (deterministic: point counts and named refusals, never a clock)", () => {
  /** A resistor chain of `chain` nodes, with a VCVS copying each chain node onto its own output node. */
  function chainWithE(chain: number, copies: number): string {
    const lines = ["V1 n0 0 1"];
    for (let k = 1; k <= chain; k++) lines.push(`R${k} n${k - 1} n${k} 1k`);
    lines.push(`Rend n${chain} 0 1k`);
    for (let k = 1; k <= copies; k++) lines.push(`E${k} x${k} 0 n${k} 0 2`);
    return lines.join("\n");
  }
  test("a sweep counts the appended E rows in its cost: 40 nodes + 10 E rows thins 120 points to 25", () => {
    const s = frequencySweep(net(chainWithE(29, 10)), "x1", 1, 1e6, 120);
    // nodes n0–n29 and x1–x10 = 40, plus 10 E rows = 50 unknowns: ⌊120·30³ / 50³⌋ = ⌊25.92⌋ = 25
    expect("points" in s).toBe(true);
    if ("points" in s) expect(s.points.length).toBe(Math.floor((120 * 30 ** 3) / 50 ** 3));
  });
  test("a sweep too large even at 12 points is refused by name; one solve of it still runs", () => {
    const text = chainWithE(60, 59); // 61 + 59 = 120 nodes, + 59 E rows = 179 unknowns
    const s = frequencySweep(net(text), "x1", 1, 1e6, 120);
    expect("ok" in s && s.ok === false && s.error).toMatch(/179 AC unknowns.*a sweep of even 12 points/);
    expect(solveAc(net(text), 1000).ok).toBe(true);
  });
  test("the same netlist without the E sources keeps the old thinning (nodes³ only)", () => {
    const lines = ["V1 n0 0 1"];
    for (let k = 1; k <= 60; k++) lines.push(`R${k} n${k - 1} n${k} 1k`);
    lines.push("Rend n60 0 1k");
    const s = frequencySweep(net(lines.join("\n")), "n1", 1, 1e6, 120);
    if ("points" in s) expect(s.points.length).toBe(Math.max(12, Math.floor((120 * 30 ** 3) / 61 ** 3)));
    else throw new Error("expected points");
  });
});

describe("independent numpy MNA rows (ORACLE 2)", () => {
  test("E op-amp integrator (A = 100 k) at 1 kHz: 1.5915335153822319 at 90.0009118815339°", () => {
    const v = node(ac("V1 1 0 1\nR1 1 2 10k\nC1 2 3 10n\nE1 3 0 0 2 100k", 1000).nodes, "3");
    expect(rel(v.magnitude, 1.5915335153822319)).toBeLessThan(1e-10);
    expect(Math.abs(v.phaseDeg - 90.0009118815339)).toBeLessThan(1e-8);
  });

  test("H and F with reactive parts at 500 Hz: 4.853482534182395 at −46.58523918176418°", () => {
    const text = "V1 1 0 1\nR1 1 2 100\nVs 2 3 0\nL1 3 0 10m\nH1 4 0 Vs 50\nC2 4 5 1u\nR5 5 0 200\nF1 0 5 Vs 3";
    const v = node(ac(text, 500).nodes, "5");
    expect(rel(v.magnitude, 4.853482534182395)).toBeLessThan(1e-10);
    expect(Math.abs(v.phaseDeg - -46.58523918176418)).toBeLessThan(1e-8);
  });

  test("three mutually coupled coils (k 0.9, 0.8, 0.7) at 2 kHz", () => {
    const text =
      "V1 1 0 1\nRs 1 4 1\nL1 4 0 1m\nL2 2 0 2m\nL3 3 0 3m\nR2 2 0 50\nR3 3 0 80\nK1 L1 L2 0.9\nK2 L1 L3 0.8\nK3 L2 L3 0.7";
    const r = ac(text, 2000);
    expect(rel(node(r.nodes, "2").magnitude, 1.1979383508814672)).toBeLessThan(1e-10);
    expect(Math.abs(node(r.nodes, "2").phaseDeg - -0.3258124765075751)).toBeLessThan(1e-8);
    expect(rel(node(r.nodes, "3").magnitude, 1.291266619391759)).toBeLessThan(1e-10);
    expect(Math.abs(node(r.nodes, "3").phaseDeg - -4.323178905035885)).toBeLessThan(1e-8);
  });

  test("VCVS buffer (gain 2) of an RC charge, transient: v(3) at 1 ms = 2(1 − e⁻¹) within 0.2 %", () => {
    const r = tran("V1 1 0 PULSE(0 1 0 1n 1n 1 2)\nR1 1 2 1k\nC1 2 0 1u\nE1 3 0 2 0 2\nRL 3 0 1k", { stop: 5e-3 });
    expect(rel(traceAt(r.times, probe(r, "3"), 1e-3), 1.2642411176571153)).toBeLessThan(0.002);
    // and it settles to the DC answer of the final source values, which solveDc gives exactly
    expect(r.finalDc && node(r.finalDc.nodes, "3").volts).toBe(2);
  });

  test("a G source in a transient: Norton RC driven by gm·v(1), τ = 1 ms", () => {
    // G1 0 2 1 0 1m with V(1) a 1 V step drives 1 mA into node 2 (R 1 kΩ ∥ C 1 µF): v = 1 − e^(−t/1 ms).
    const r = tran("V1 1 0 PULSE(0 1 0 1n 1n 1 2)\nR0 1 0 1k\nG1 0 2 1 0 1m\nR2 2 0 1k\nC2 2 0 1u", { stop: 5e-3 });
    expect(rel(traceAt(r.times, probe(r, "2"), 1e-3), 1 - Math.exp(-1))).toBeLessThan(0.002);
  });
});

describe("k = 1 exactly", () => {
  test("a transformer with k = 1 and a load solves to the ideal ratio √(L₂/L₁) = 2", () => {
    const v = node(ac(XFMR.replace("0.99", "1"), 1000).nodes, "2");
    expect(v.magnitude).toBeCloseTo(2, 9);
    expect(v.phaseDeg).toBeCloseTo(0, 6);
  });

  test("k = 1 with a voltage source on each winding is singular and says why", () => {
    const r = solveAc(net("V1 1 0 1\nL1 1 0 1m\nL2 2 0 4m\nK1 L1 L2 1\nV2 2 0 1"), 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/K1 couples L1 and L2 with k = 1 exactly/);
      expect(r.error).toMatch(/L₁L₂ − M² = 0/);
      expect(r.error).toMatch(/0\.9999/);
    }
    // the same circuit at k = 0.99 is not singular
    expect(solveAc(net("V1 1 0 1\nL1 1 0 1m\nL2 2 0 4m\nK1 L1 L2 0.99\nV2 2 0 1"), 1000).ok).toBe(true);
  });

  test("a sweep with k = 1 that is regular runs", () => {
    const s = frequencySweep(net(XFMR.replace("0.99", "1")), "2", 10, 1e5, 40);
    expect("points" in s && s.points.length).toBe(40);
  });
});

describe("refusals, each named", () => {
  test.each([
    ["k above 1", "L1 1 0 1m\nL2 2 0 1m\nK1 L1 L2 1.01", /k = 1\.01, above 1.*cannot exceed 1/],
    ["k = 0", "L1 1 0 1m\nL2 2 0 1m\nK1 L1 L2 0", /0 < k ≤ 1.*delete the K line/],
    ["negative k", "L1 1 0 1m\nL2 2 0 1m\nK1 L1 L2 -0.5", /swap the two nodes of one inductor/],
    ["coupling a resistor", "L1 1 0 1m\nR1 1 0 1\nK1 L1 R1 0.5", /K1 couples R1, which is a resistor\. Only inductors can be coupled/],
    ["coupling an unknown name", "L1 1 0 1m\nK1 L1 L9 0.5", /K1 couples "L9", but no element is called that/],
    ["coupling an inductor to itself", "L1 1 0 1m\nK1 L1 l1 0.5", /couples L1 to itself/],
    ["one pair coupled twice", "L1 1 0 1m\nL2 2 0 1m\nK1 L1 L2 0.5\nK2 L2 L1 0.6", /coupled by more than one K line/],
    ["impossible k set", "L1 1 0 1m\nL2 2 0 1m\nL3 3 0 1m\nK1 L1 L2 0.99\nK2 L1 L3 0.99", /cannot all hold at once/],
    ["K with too many fields", "L1 1 0 1m\nL2 2 0 1m\nL3 3 0 1m\nK1 L1 L2 L3 0.9", /one K line per pair/],
    ["H with an unknown source", "V1 1 0 1\nH1 2 0 Vx 1k\nR1 2 0 1", /H1 is controlled by the current through "Vx", but no element is called that.*0 V source in series/],
    ["F naming a resistor", "V1 1 0 1\nR1 1 0 1\nF1 2 0 R1 2\nR2 2 0 1", /F1 names R1 as its controlling source, but R1 is a resistor/],
    ["E with five fields", "V1 1 0 1\nE1 2 0 1 10", /needs exactly 6 fields for a voltage-controlled voltage source/],
    ["G with seven fields", "V1 1 0 1\nG1 2 0 1 0 1m 5", /needs exactly 6 fields for a voltage-controlled current source/],
    ["H with four fields", "V1 1 0 1\nH1 2 0 1k", /needs exactly 5 fields for a current-controlled voltage source/],
    ["POLY form", "V1 1 0 1\nE1 2 0 POLY(1) 1 0 0 10", /behavioural form/],
    ["VALUE form", "V1 1 0 1\nE1 2 0 VALUE={V(1)*2}", /behavioural form/],
    ["controlling nodes equal", "V1 1 0 1\nE1 2 0 1 1 10\nR1 2 0 1", /controlling nodes are both 1/],
    ["controlling nodes both ground", "V1 1 0 1\nG1 2 0 0 gnd 10\nR1 2 0 1", /controlling nodes are both 0/],
    ["E output shorted", "V1 1 0 1\nE1 2 2 1 0 10", /both ends on node 2, which shorts it out/],
    ["G output on one node", "V1 1 0 1\nG1 2 2 1 0 10m\nR1 2 0 1", /current leaves and re-enters the same node/],
    ["unreadable gain", "V1 1 0 1\nE1 2 0 1 0 ten", /Could not read the value "ten"/],
    ["wrong quantity in a gain", "V1 1 0 1\nE1 2 0 1 0 5kg", /Could not read the value "5kg"/],
    ["non-finite gain", "V1 1 0 1\nE1 2 0 1 0 1e400", /Could not read the value "1e400"/],
    ["NaN gain", "V1 1 0 1\nG1 2 0 1 0 nan", /Could not read the value "nan"/],
    ["duplicate name", "V1 1 0 1\nE1 2 0 1 0 2\nE1 3 0 1 0 2", /Two elements are both called "E1"/],
  ])("%s", (_what, text, want) => {
    expect(parseErr(text)).toMatch(want);
  });

  test("a controlling node that nothing else touches has no DC path, named", () => {
    const r = solveDc(net("V1 1 0 1\nR1 1 0 1k\nE1 2 0 9 0 10\nR2 2 0 1k"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Node 9 has no DC path to ground/);
  });

  test("a feedback loop whose gain is exactly 1 is singular, and the message points at the gains", () => {
    // E1 out 0 out 0 1: V(out) = 1·V(out), any value.
    const r = solveDc(net("V1 1 0 1\nR1 1 0 1k\nE1 out 0 out 0 1\nR2 out 0 1k"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/gain exactly cancels.*check the gains/);
  });

  test("an E source in parallel with a V source is named as two sources setting one voltage", () => {
    const r = solveDc(net("V1 1 0 1\nE1 1 0 1 0 2\nR1 1 0 1"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/in parallel with another voltage source/);
  });

  test("controlled sources alone, with no independent source, are refused as sourceless", () => {
    const r = solveDc(net("R1 1 0 1k\nE1 2 0 1 0 10\nR2 2 0 1k"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no source in this circuit/);
  });

  test("forward references resolve: H and K may name an element declared later", () => {
    expect(parseNetlist("H1 3 0 Vs 500\nV1 1 0 10\nR1 1 2 1k\nVs 2 0 0\nR3 3 0 1k").errors).toEqual([]);
    expect(parseNetlist("K1 l1 L2 0.5\nV1 1 0 1\nL1 1 0 1m\nL2 2 0 1m\nR2 2 0 1").errors).toEqual([]);
  });
});

describe("the transient pane tool", () => {
  test("runs the transformer, states the dot convention, draws, and keeps the display contract", () => {
    const o = run({ net: XFMR_TRAN, stop: "5m", step: "1u" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/dot at each inductor's FIRST node/);
    expect((o.blocks ?? []).filter((b) => b.kind === "plot").length).toBe(1);
    contractClean(o.text);
  });

  test("an E netlist that the tool used to refuse now runs; a still-unsupported device is named with the new scope", () => {
    const o = run({ net: "V1 1 0 5\nE1 2 0 1 0 10\nR1 2 0 1k", stop: "1m" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("Final-value check: V(2) settles to 50 V; DC operating point 50 V.");
    expect(o.text).toMatch(/Controlled sources \(E, G, H, F\) are ideal and linear/);
    contractClean(o.text);
    const q = run({ net: "V1 1 0 5\nQ1 1 2 0 2N3904" });
    expect(q.ok).toBe(false);
    expect(q.text).toMatch(
      /"Q1" \(a bipolar transistor\) is not supported\. It also covers the linear controlled sources E, G, H, F and coupled inductors K/,
    );
  });

  test("an E line's controlling node names are checked like the others", () => {
    expect(run({ net: "V1 1 0 5\nE1 2 0 nan 0 10\nR1 2 0 1k" }).text).toMatch(/"nan" cannot be an element or node name/);
  });
});
