// Release C, gap #10: circuit transient analysis. The FIXED CASE TABLE (rows 1–13 of
// the brief) plus adversarial rows. Every later fix round must keep every row's outcome.
//
// ORACLE. Closed forms where they exist, and scipy for the rest, run in the statvenv:
//
//   import numpy as np
//   from scipy import signal
//   # Case 3: series RLC, v_C/v_in = 1/(LC s^2 + RC s + 1), unit step
//   R, L, C = 10.0, 1e-3, 1e-6
//   sys = signal.lti([1.0], [L*C, R*C, 1.0])
//   ts = np.array([0.1e-3, 0.2e-3, 0.3e-3, 0.5e-3, 0.8e-3])
//   t = np.linspace(0, 1e-3, 200001)
//   _, y = signal.step(sys, T=t)
//   print([float(np.interp(x, t, y)) for x in ts])
//   # -> [1.604565789000562, 0.6346377458900934, 1.220718706453181, 1.0804582724021938, 0.9823438696610339]
//   # Case 1 with the actual 1 ns ramp (lsim), RC = 1 ms
//   t1 = np.linspace(0, 5e-3, 500001); u = np.clip(t1/1e-9, 0, 1)*5
//   _, y1, _ = signal.lsim(signal.lti([1.0], [1e-3, 1.0]), u, t1)
//   print(np.interp(1e-3, t1, y1), np.interp(5e-3, t1, y1))   # -> 3.1605935971254033 4.96631009655891
//   # Case 2: RL, v(2) = 10 exp(-t/tau), i_L = 0.1 (1 - exp(-t/tau)), tau = 0.1 ms
//   print(10*np.exp(-1), 0.1*(1-np.exp(-1)))                   # -> 3.6787944117144233 0.06321205588285576
//   # Case 5: RC low-pass at f = 1/(2 pi RC): H = 1/(1 + j)
//   print(abs(1/(1+1j)), np.degrees(np.angle(1/(1+1j))))      # -> 0.7071067811865476 -45.0

import { parseNetlist, solveDc, solveAc, frequencySweep, Element } from "../circuit";
import { solveTransient, traceAt, TransientOk, BE_RUN } from "../circuitTransient";
import { CIRCUIT_CALCS, readTime } from "../circuitCalcs";
import type { AnalyzeOutput } from "../analyzeBlocks";

const calc = CIRCUIT_CALCS[0];

function net(text: string): Element[] {
  const p = parseNetlist(text);
  if (p.errors.length) throw new Error(`netlist errors: ${p.errors.join(" | ")}`);
  return p.elements;
}
function tran(text: string, req: Parameters<typeof solveTransient>[1]): TransientOk {
  const r = solveTransient(net(text), req);
  if (!r.ok) throw new Error(`expected a run, got: ${r.error}`);
  return r;
}
function run(over: Record<string, string>): AnalyzeOutput {
  const v: Record<string, string> = Object.fromEntries(calc.fields.map((f) => [f.key, f.default]));
  Object.assign(v, over);
  return calc.compute((k) => v[k] ?? "");
}
const at = (r: TransientOk, node: string, t: number): number => {
  const p = r.probes.find((x) => x.name === node);
  if (!p) throw new Error(`no probe ${node}`);
  return traceAt(r.times, p.values, t);
};
const plots = (o: AnalyzeOutput): number => (o.blocks ?? []).filter((b) => b.kind === "plot").length;

/** The display contract, as the result reaches Word. */
function contractClean(text: string): void {
  expect(text).not.toMatch(/\d[eE][+-]?\d/);
  expect(text).not.toMatch(/NaN|Infinity|undefined/);
  expect(text).not.toContain("—");
  expect(text).not.toContain("^");
  expect(text).not.toMatch(/(^|[\s(=:,])-\d/m);
}

/** Successive differences that flip sign with both above `floor`, counted. */
function flips(v: Float64Array, from: number, count: number, floor: number): number {
  let n = 0;
  for (let i = from; i < Math.min(v.length - 2, from + count); i++) {
    const d1 = v[i + 1] - v[i];
    const d2 = v[i + 2] - v[i + 1];
    if (d1 * d2 < 0 && Math.abs(d1) > floor && Math.abs(d2) > floor) n++;
  }
  return n;
}

const RC = "V1 1 0 PULSE(0 5 0 1n 1n 1 2)\nR1 1 2 1k\nC1 2 0 1u";

describe("fixed case table", () => {
  test("1 RC charge: v(2) at 1 ms = 5(1 − e⁻¹) = 3.1606 V within 0.2 %, at 5 ms ≈ 4.966 V", () => {
    const r = tran(RC, { stop: 5e-3 });
    expect(Math.abs(at(r, "2", 1e-3) - 3.1605935971254033) / 3.1606).toBeLessThan(0.002);
    expect(Math.abs(at(r, "2", 5e-3) - 4.96631009655891) / 4.966).toBeLessThan(0.002);
    // 1 ms is a grid point: no interpolation is involved.
    expect(Array.from(r.times)).toContain(1e-3);
    const o = run({ net: RC, stop: "5m" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("t = 1 ms: V(1) = 5 V, V(2) = 3.161 V");
    expect(o.text).toMatch(/V\(2\) has not settled by the stop time: 4\.966 V against a DC operating point of 5 V/);
    expect(plots(o)).toBe(1);
    contractClean(o.text);
  });

  test("2 RL: i_L = 0.1(1 − e^(−t/0.1 ms)); v(2) at 0.1 ms = 10e⁻¹ = 3.679 V", () => {
    const r = tran("V1 1 0 PULSE(0 10 0 1n 1n 1 2)\nR1 1 2 100\nL1 2 0 10m", { stop: 1e-3, currents: ["L1"] });
    expect(Math.abs(at(r, "2", 1e-4) - 3.6787944117144233) / 3.679).toBeLessThan(0.002);
    const iL = traceAt(r.times, r.currents[0].values, 1e-4);
    expect(Math.abs(iL - 0.06321205588285576) / 0.0632).toBeLessThan(0.002);
    // and the inductor current at 1 ms (10τ) is the DC value 0.1 A
    expect(r.currents[0].values[r.currents[0].values.length - 1]).toBeCloseTo(0.1, 4);
  });

  test("3 series RLC underdamped: v_C against the analytic response at 5 times (±0.5 % of the step)", () => {
    const r = tran("V1 1 0 PULSE(0 1 0 1n 1n 1 2)\nR1 1 2 10\nL1 2 3 1m\nC1 3 0 1u", { stop: 1e-3 });
    const ts = [0.1e-3, 0.2e-3, 0.3e-3, 0.5e-3, 0.8e-3];
    const ref = [1.604565789000562, 0.6346377458900934, 1.220718706453181, 1.0804582724021938, 0.9823438696610339];
    ts.forEach((t, i) => expect(Math.abs(at(r, "3", t) - ref[i])).toBeLessThan(0.005));
    // closed form cross-check of the scipy numbers: 1 − e^(−αt)(cos ωd t + α/ωd sin ωd t)
    const a = 5000;
    const wd = Math.sqrt(1 / (1e-3 * 1e-6) - a * a);
    ts.forEach((t, i) =>
      expect(1 - Math.exp(-a * t) * (Math.cos(wd * t) + (a / wd) * Math.sin(wd * t))).toBeCloseTo(ref[i], 6),
    );
  });

  test("4 DC sources only: flat at 6 V from t = 0; the settle check equals the DC tool exactly", () => {
    const text = "V1 1 0 9\nR1 1 2 1k\nR2 2 0 2k\nC1 2 0 1u";
    const r = tran(text, { stop: 5e-3 });
    for (const v of r.probes[1].values) expect(Math.abs(v - 6)).toBeLessThan(1e-12);
    const dc = solveDc(net(text));
    if (!dc.ok) throw new Error(dc.error);
    const dcNode = dc.nodes.find((n) => n.name === "2");
    const finNode = r.finalDc?.nodes.find((n) => n.name === "2");
    expect(finNode?.exact).toEqual(dcNode?.exact);
    expect(finNode?.volts).toBe(6);
    const o = run({ net: text, stop: "5m" });
    expect(o.text).toContain("Final-value check: V(2) settles to 6 V; DC operating point 6 V.");
    expect(o.text).toContain("Starting point (DC operating point at t = 0): V(1) = 9 V, V(2) = 6 V");
    contractClean(o.text);
  });

  test("5 SIN on an RC low-pass at f = 1/(2πRC): amplitude 1/√2, lag 45° (±1 %), matching the AC tool", () => {
    const f = 1 / (2 * Math.PI * 1e-3);
    const r = tran(`V1 1 0 SIN(0 1 ${f} 0)\nR1 1 2 1k\nC1 2 0 1u`, { stop: 36e-3 });
    // Least squares v ≈ a sin ωt + b cos ωt + c over four whole periods from 10τ.
    const w = 2 * Math.PI * f;
    const t0 = 10e-3;
    const t1 = t0 + 4 / f;
    const S = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const B = [0, 0, 0];
    const v = r.probes[1].values;
    r.times.forEach((t, i) => {
      if (t < t0 || t > t1) return;
      const row = [Math.sin(w * t), Math.cos(w * t), 1];
      for (let p = 0; p < 3; p++) {
        B[p] += row[p] * v[i];
        for (let q = 0; q < 3; q++) S[p][q] += row[p] * row[q];
      }
    });
    // 3×3 solve by Cramer's rule
    const det = (M: number[][]): number =>
      M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
      M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
      M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const D = det(S);
    const col = (k: number): number[][] => S.map((row, i) => row.map((x, j) => (j === k ? B[i] : x)));
    const a = det(col(0)) / D;
    const b = det(col(1)) / D;
    const amp = Math.hypot(a, b);
    const phase = (Math.atan2(b, a) * 180) / Math.PI;
    expect(Math.abs(amp - Math.SQRT1_2) / Math.SQRT1_2).toBeLessThan(0.01);
    expect(Math.abs(phase + 45) / 45).toBeLessThan(0.01);
    const ac = solveAc(net("V1 1 0 1\nR1 1 2 1k\nC1 2 0 1u"), f);
    if (!ac.ok) throw new Error(ac.error);
    const n2 = ac.nodes.find((n) => n.name === "2");
    expect(Math.abs(amp - (n2?.magnitude ?? 0))).toBeLessThan(0.01 * Math.SQRT1_2);
    expect(Math.abs(phase - (n2?.phaseDeg ?? 0))).toBeLessThan(0.45);
  });

  test("6a trapezoidal-ringing guard: C straight across a step source through 0.1 Ω (h/τ = 100)", () => {
    const r = tran("V1 1 0 PULSE(0 5 1m 1n 1n 1 2)\nR1 1 2 0.1\nC1 2 0 1u", { stop: 10e-3 });
    const i0 = r.times.findIndex((t) => t >= 1e-3);
    // No Nyquist-rate flip above a micro-volt-per-volt floor in the 10 steps after the step.
    expect(flips(r.probes[1].values, i0, 10 + BE_RUN, 5e-6)).toBe(0);
    expect(r.notes.join(" ")).not.toMatch(/flips up and down/);
  });

  test("6b ringing guard at h/τ = 1000 (0.01 Ω) and h/τ = 10 (1 Ω): no flip in 10 steps above 10⁻⁴ of the swing", () => {
    for (const R of ["0.01", "1"]) {
      const r = tran(`V1 1 0 PULSE(0 5 1m 1n 1n 1 2)\nR1 1 2 ${R}\nC1 2 0 1u`, { stop: 10e-3 });
      const i0 = r.times.findIndex((t) => t >= 1e-3);
      expect(flips(r.probes[1].values, i0, 10 + BE_RUN, 5e-4)).toBe(0);
    }
  });

  test("6c LC tank hit by a step: rings at its own frequency, never at the Nyquist rate; amplitude kept", () => {
    const r = tran("V1 1 0 PULSE(0 1 0.1m 1n 1n 1 2)\nL1 1 2 1m\nC1 2 0 1u", { stop: 2e-3 });
    const v = r.probes[1].values;
    const i0 = r.times.findIndex((t) => t >= 0.1e-3);
    expect(flips(v, i0, 10 + BE_RUN, 1e-9)).toBe(0);
    // v_C = 1 − cos ω0(t − 0.1 ms): peaks at 2 V; the trapezoidal rule conserves the tank's energy
    let peak = 0;
    for (const x of v) peak = Math.max(peak, x);
    expect(Math.abs(peak - 2)).toBeLessThan(0.02);
    // one period later (0.2 ms) it is back near 0
    expect(Math.abs(at(r, "2", 0.1e-3 + 2 * Math.PI * Math.sqrt(1e-9)))).toBeLessThan(0.03);
  });

  test("7 floating node: the DC tool's refusal text, plus what to change", () => {
    const text = "V1 1 0 PULSE(0 5 0 1n 1n 1 2)\nR1 1 2 1k\nC1 2 3 1u";
    const dc = solveDc(net(text));
    if (dc.ok) throw new Error("expected the DC tool to refuse");
    const o = run({ net: text });
    expect(o.ok).toBe(false);
    expect(o.text.startsWith(dc.error)).toBe(true);
    expect(o.text).toMatch(/Node 3 has no DC path to ground/);
    expect(o.text).toMatch(/1G/);
  });

  test("8 capacitor in series with a current source: named refusal", () => {
    const o = run({ net: "I1 0 1 1m\nC1 1 2 1u\nR1 2 0 1k" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/Capacitor C1 is in series with current source I1 at node 1/);
  });

  test("9 D1 1 0 1N4148: unsupported element, named", () => {
    const o = run({ net: "V1 1 0 5\nR1 1 2 1k\nD1 2 0 1N4148" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/^Transient analysis covers R, L, C, V and I; "D1" \(a diode\) is not supported\./);
  });

  test.each([
    [{ stop: "−1m" }, /stop time must be greater than 0/],
    [{ stop: "-1m" }, /stop time must be greater than 0/],
    [{ stop: "0" }, /stop time must be greater than 0/],
    [{ stop: "abc" }, /stop time "abc" is not a time/],
    [{ stop: "1m", step: "2m" }, /time step \(2 ms\) is longer than the stop time \(1 ms\)/],
    [{ stop: "1m", step: "0" }, /time step must be greater than 0/],
    [{ stop: "1m", step: "x" }, /time step "x" is not a time/],
    [{ stop: "1e999" }, /not a time/],
  ])("10 time-field refusal %j", (over, re) => {
    const o = run(over);
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(re);
  });

  test("11 PULSE with PER smaller than TR + PW + TF: named refusal (all three tools, one parser)", () => {
    const text = "V1 1 0 PULSE(0 5 0 1u 1u 1m 0.5m)\nR1 1 0 1k";
    expect(parseNetlist(text).errors.join(" ")).toMatch(/period PER is shorter than TR \+ PW \+ TF/);
    const o = run({ net: text });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/period PER is shorter than TR \+ PW \+ TF/);
    // TR and TF left at 0 become one time step (SPICE), which can make PER too short only then.
    const o2 = run({ net: "V1 1 0 PULSE(0 5 0 0 0 1m 1m)\nR1 1 0 1k", stop: "10m" });
    expect(o2.ok).toBe(false);
    expect(o2.text).toMatch(/rise and fall times taken as one time step/);
  });

  function ladder(sections: number, rTail = true): string {
    let s = "V1 n0 0 PULSE(0 1 0 1u 1u 1 2)\n";
    for (let k = 1; k <= sections; k++) {
      s += `R${k} n${k - 1} n${k} 1k\n`;
      if (k < sections || !rTail) s += `C${k} n${k} 0 1n\n`;
    }
    return s;
  }

  test("12 60-element RC ladder at 200 000 steps finishes under the ceiling; one more is refused", () => {
    const text = ladder(30);
    expect(net(text).length).toBe(60);
    const t0 = Date.now();
    const r = tran(text, { stop: 0.2, step: 1e-6, probes: ["n1", "n10", "n20", "n29"] });
    const ms = Date.now() - t0;
    expect(r.steps).toBe(200000);
    expect(ms).toBeLessThan(1500); // measured ~175 ms; the ceiling is generous for a loaded CI box
    // the far end of the ladder settles to the source's 1 V (no load: no current at DC)
    expect(at(r, "n29", 0.2)).toBeCloseTo(1, 6);
    const tooMany = solveTransient(net(text + "R99 n29 0 1meg"), { stop: 1e-3 });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error).toMatch(/at most 60/);
    const tooLong = solveTransient(net(text), { stop: 0.2, step: 0.999e-6 });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error).toMatch(/the most is 200000/);
  });

  test("13 DC and AC tools: plain netlists parse to exactly the old objects (no wave key)", () => {
    // The full byte-identity check ran the three existing circuit test files with every
    // parseNetlist/solveDc/solveAc/frequencySweep call recorded, before and after this
    // change: 575 calls, identical output. Those files stay in the suite. Here: the pane defaults.
    for (const text of ["V1 1 0 5\nR1 1 2 1k\nR2 2 0 2k", "V1 1 0 1\nR1 1 2 1k\nC1 2 0 1u"]) {
      for (const e of net(text)) expect("wave" in e).toBe(false);
    }
    const dc = solveDc(net("V1 1 0 5\nR1 1 2 1k\nR2 2 0 2k"));
    if (!dc.ok) throw new Error(dc.error);
    expect(dc.nodes.map((n) => `${n.name}=${n.exact?.n}/${n.exact?.d}`)).toEqual(["1=5/1", "2=10/3"]);
    expect(dc.notes).toEqual([]);
    const ac = solveAc(net("V1 1 0 1\nR1 1 2 1k\nC1 2 0 1u"), 1000);
    if (!ac.ok) throw new Error(ac.error);
    expect(ac.notes.length).toBe(1);
  });
});

describe("one netlist, three tools", () => {
  test("DC tool on a PULSE source: its value at t = 0, as SPICE, and says so", () => {
    const r = solveDc(net("V1 1 0 PULSE(2 5 0 1n 1n 1m 2m)\nR1 1 2 1k\nR2 2 0 1k"));
    if (!r.ok) throw new Error(r.error);
    expect(r.nodes.find((n) => n.name === "2")?.volts).toBe(1);
    expect(r.exact).toBe(true);
    expect(r.notes.join(" ")).toMatch(/V1 \(PULSE\): a time-varying source is solved here at its value at t = 0, as SPICE does/);
  });

  test("DC tool on SIN and PWL: VO and the first PWL value", () => {
    const r = solveDc(net("V1 1 0 SIN(1.5 1 1k)\nI1 0 2 PWL(0 2m 1m 0)\nR1 1 0 1k\nR2 2 0 1k"));
    if (!r.ok) throw new Error(r.error);
    expect(r.nodes.map((n) => n.volts)).toEqual([1.5, 2]);
  });

  test("AC tool: a waveform source has no AC amplitude (SPICE); all-waveform circuits are refused", () => {
    const only = solveAc(net("V1 1 0 SIN(0 1 1k)\nR1 1 2 1k\nC1 2 0 1u"), 159);
    expect(only.ok).toBe(false);
    if (!only.ok) expect(only.error).toMatch(/waveform source has no AC amplitude/);
    const mixed = solveAc(net("V1 1 0 1\nR1 1 2 1k\nR2 2 3 1k\nV2 3 0 PULSE(0 5 0 1n 1n 1m 2m)"), 100);
    if (!mixed.ok) throw new Error(mixed.error);
    // V2 is a short, so node 2 is the 1 V source halved
    expect(mixed.nodes.find((n) => n.name === "2")?.magnitude).toBeCloseTo(0.5, 12);
    expect(mixed.notes.join(" ")).toMatch(/V2 \(PULSE\): as in SPICE, a waveform source has no AC amplitude/);
    const sw = frequencySweep(net("V1 1 0 1\nR1 1 2 1k\nC1 2 0 1u\nI2 0 2 SIN(0 1m 1k)"), "2", 10, 1e4, 20);
    expect("points" in sw && sw.error).toMatch(/I2 \(SIN\)/);
  });

  test("same netlist, three answers that agree: transient end = DC tool; transient start = DC at t = 0", () => {
    const text = "V1 1 0 PWL(0 1 1m 1 1.1m 4)\nR1 1 2 2k\nR2 2 0 1k\nC1 2 0 100n";
    const r = tran(text, { stop: 3e-3 });
    const dcStart = solveDc(net(text));
    if (!dcStart.ok) throw new Error(dcStart.error);
    expect(r.probes[1].values[0]).toBeCloseTo(dcStart.nodes[1].volts, 12);
    expect(at(r, "2", 3e-3)).toBeCloseTo(4 / 3, 6);
    expect(r.finalDc?.nodes[1].exact).toEqual({ n: 4n, d: 3n });
  });
});

describe("adversarial", () => {
  test("netlist keywords: EXP, AC and a DC value with a waveform are refused by name; DC 5 is read as 5", () => {
    expect(parseNetlist("V1 1 0 EXP(0 1 0 1m)\nR1 1 0 1k").errors.join(" ")).toMatch(/uses an EXP waveform, which is not supported/);
    expect(parseNetlist("V1 1 0 AC 1\nR1 1 0 1k").errors.join(" ")).toMatch(/"AC" magnitude on a source is not read/);
    expect(parseNetlist("V1 1 0 DC 5 PULSE(0 1)\nR1 1 0 1k").errors.join(" ")).toMatch(/DC value together with a waveform/);
    const ok = parseNetlist("V1 1 0 DC 5\nR1 1 0 1k");
    expect(ok.errors).toEqual([]);
    expect(ok.elements[0].value).toBe(5);
  });

  test("PWL and SIN shapes: odd count, non-increasing times, extra SIN values, zero frequency", () => {
    const e = (s: string): string => parseNetlist(`V1 1 0 ${s}\nR1 1 0 1k`).errors.join(" ");
    expect(e("PWL(0 0 1m)")).toMatch(/even count/);
    expect(e("PWL(0 0 1m 5 1m 0)")).toMatch(/must increase strictly/);
    expect(e("PWL(0 0 -1m 5)")).toMatch(/negative/);
    expect(e("SIN(0 1 1k 0 100 90)")).toMatch(/at most four values/);
    expect(e("SIN(0 1 0)")).toMatch(/FREQ in SIN\(…\) must be greater than 0/);
    expect(e("PULSE(0 5 0 1n 1n 1m 2m 3)")).toMatch(/at most seven values/);
    expect(e("PULSE(0 5 -1m)")).toMatch(/TD \(the delay\) in PULSE\(…\) is negative/);
    expect(e("PULSE(0 5 0 1n 1n 1m 2m")).toMatch(/could not read PULSE/);
    expect(e("PULSE(0 5 0 1n 1n x)")).toMatch(/Could not read "x"/);
    expect(e("PULSE(0 5 0 1n 1n 1m 2m)")).toBe("");
    expect(e("PULSE 0 5 0 1n 1n 1m 2m")).toBe("");
  });

  test("a sine the step cannot follow is refused, not aliased", () => {
    const o = run({ net: "V1 1 0 SIN(0 1 1k)\nR1 1 0 1k", stop: "1" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/1000 Hz sine, and a time step of 1 ms gives only 1 samples per period/);
    expect(o.text).toMatch(/at most 50 µs/);
    contractClean(o.text);
  });

  test("a coupling capacitor into a 1 GΩ bias (τ = 1000 s) is reported as not settled, never refused", () => {
    const o = run({ net: "V1 1 0 PULSE(0 5 0 1n 1n 1 2)\nC1 1 2 1u\nR1 2 0 1G", stop: "0.5m" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/V\(2\) has not settled by the stop time/);
    contractClean(o.text);
  });

  test("an operating-point failure that is not a floating node gets the DC tool's own remedy, not the 1G advice", () => {
    const text = "V1 1 0 PULSE(0 5 0 1n 1n 1 2)\nL1 1 0 1m";
    const o = run({ net: text });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/completes a loop of voltage sources and inductors/);
    expect(o.text).not.toMatch(/1G/);
  });

  test("a SPICE + continuation line is named", () => {
    expect(run({ net: "V1 1 0 PWL(0 0 1m 1\n+ 2m 0)\nR1 1 0 1k" }).text).toMatch(/continuation of the line above/);
  });

  test("SPICE control lines and other devices are named", () => {
    expect(run({ net: ".tran 1u 5m\nV1 1 0 5\nR1 1 0 1k" }).text).toMatch(/"\.tran" is a SPICE control line/);
    expect(run({ net: "V1 1 0 5\nQ1 1 2 0 2N3904" }).text).toMatch(/"Q1" \(a bipolar transistor\) is not supported/);
    // Release E (E3-a) added E, G, H, F and K to the transient tool, so this row now names a
    // device that is still outside it (it used to assert that E1 was refused).
    expect(run({ net: "V1 1 0 5\nS1 2 0 1 0 sw" }).text).toMatch(/"S1" \(a voltage-controlled switch\)/);
  });

  test("nodes field: choice, V(n) form, ground, unknown, too many", () => {
    const o = run({ nodes: "V(2)" });
    expect(o.text).toContain("t = 1 ms: V(2) = ");
    expect(o.text).not.toContain("V(1) = 5 V, V(2)");
    expect(run({ nodes: "0" }).text).toMatch(/Node 0 is ground/);
    expect(run({ nodes: "7" }).text).toMatch(/no node called "7"\. Nodes here are: 1, 2/);
    let big = "V1 n0 0 1\n";
    for (let k = 1; k <= 8; k++) big += `R${k} n${k - 1} n${k} 1k\n`;
    big += "R9 n8 0 1k";
    expect(run({ net: big, nodes: "n1 n2 n3 n4 n5 n6 n7" }).text).toMatch(/At most 6 nodes/);
    const dflt = run({ net: big, stop: "1m" });
    expect(dflt.ok).not.toBe(false);
    expect(dflt.text).toMatch(/figure shows the first 6 \(n0, n1, n2, n3, n4, n5\)/);
  });

  test("time fields read 5m, 5ms, 5 ms, 10 µs, 10us, 1e-3, 2s", () => {
    expect(readTime("5m")).toBeCloseTo(5e-3, 15);
    expect(readTime("5ms")).toBeCloseTo(5e-3, 15);
    expect(readTime("5 ms")).toBeCloseTo(5e-3, 15);
    expect(readTime("10 µs")).toBeCloseTo(1e-5, 18);
    expect(readTime("10us")).toBeCloseTo(1e-5, 18);
    expect(readTime("1e-3")).toBeCloseTo(1e-3, 15);
    expect(readTime("1e-3s")).toBeCloseTo(1e-3, 15);
    expect(readTime("2s")).toBe(2);
    expect(readTime("ms")).toBeNull();
    expect(readTime("")).toBeNull();
  });

  test("corners are landed on exactly, even off the grid", () => {
    const r = tran("V1 1 0 PULSE(0 1 0.123456m 1n 1n 0.5m)\nR1 1 2 1k\nC1 2 0 10n", { stop: 1e-3 });
    const ts = Array.from(r.times);
    for (const c of [0.123456e-3, 0.123456e-3 + 1e-9, 0.123456e-3 + 1e-9 + 0.5e-3, 0.123456e-3 + 2e-9 + 0.5e-3])
      expect(ts.some((t) => Math.abs(t - c) < 1e-18)).toBe(true);
    expect(r.breakpoints).toBe(4);
    expect(ts[ts.length - 1]).toBe(1e-3);
    // the source is exactly at its levels at the corners: the RC never overshoots 1 V
    for (const v of r.probes[1].values) expect(v).toBeLessThanOrEqual(1 + 1e-12);
  });

  test("step that does not divide the stop time: last step short, ends exactly at stop", () => {
    const r = tran(RC, { stop: 1e-3, step: 3e-6 });
    expect(r.times[r.times.length - 1]).toBe(1e-3);
    expect(at(r, "2", 1e-3)).toBeCloseTo(5 * (1 - Math.exp(-1)), 3);
  });

  test("linearity: doubling every source doubles every voltage", () => {
    const a = tran("V1 1 0 PULSE(0 1 0 1u 1u 1m 2m)\nR1 1 2 1k\nL1 2 3 10m\nC1 3 0 1u\nI1 0 3 SIN(0 1m 500)", { stop: 5e-3 });
    const b = tran("V1 1 0 PULSE(0 2 0 1u 1u 1m 2m)\nR1 1 2 1k\nL1 2 3 10m\nC1 3 0 1u\nI1 0 3 SIN(0 2m 500)", { stop: 5e-3 });
    for (let i = 0; i < a.times.length; i += 97) expect(b.probes[2].values[i]).toBeCloseTo(2 * a.probes[2].values[i], 10);
  });

  test("current-source pulse through a resistor: v = I·R at every sample", () => {
    const r = tran("I1 0 1 PULSE(0 2m 0.1m 1u 1u 0.3m)\nR1 1 0 1k", { stop: 1e-3 });
    r.times.forEach((t, i) => {
      const I = t <= 0.1e-3 ? 0 : t < 0.1e-3 + 1e-6 ? (2e-3 * (t - 0.1e-3)) / 1e-6 : t <= 0.401e-3 ? 2e-3 : t < 0.402e-3 ? 2e-3 * (1 - (t - 0.401e-3) / 1e-6) : 0;
      expect(r.probes[0].values[i]).toBeCloseTo(I * 1000, 9);
    });
  });

  test("inductor initial current comes from the DC operating point (L shorted)", () => {
    const r = tran("V1 1 0 10\nR1 1 2 100\nL1 2 0 10m", { stop: 1e-3, currents: ["L1"] });
    for (const i of r.currents[0].values) expect(i).toBeCloseTo(0.1, 12);
    for (const v of r.probes[1].values) expect(Math.abs(v)).toBeLessThan(1e-12);
  });

  test("huge and tiny magnitudes: 1 GΩ bias beside 1 µF; 1 pF with 1 MΩ over 10 µs", () => {
    const big = tran("V1 1 0 PULSE(0 1 0 1n 1n 1 2)\nR1 1 2 1k\nC1 2 0 1u\nR2 2 0 1G", { stop: 10e-3 });
    expect(at(big, "2", 10e-3)).toBeCloseTo(1 - Math.exp(-10), 4);
    const tiny = tran("V1 1 0 PULSE(0 1 0 1p 1p 1 2)\nR1 1 2 1meg\nC1 2 0 1p", { stop: 10e-6 });
    expect(at(tiny, "2", 1e-6)).toBeCloseTo(1 - Math.exp(-1), 3);
    const o = run({ net: "V1 1 0 PULSE(0 1m 0 1p 1p 1 2)\nR1 1 2 1meg\nC1 2 0 1p", stop: "5u" });
    expect(o.text).toMatch(/Time step 5 ns/);
    expect(o.text).toMatch(/mV/);
    contractClean(o.text);
  });

  test("a repeating pulse misaligned with the step is fast, or refused by name", () => {
    const t0 = Date.now();
    const r = solveTransient(net("V1 1 0 PULSE(0 1 0 1.3u 1.7u 3.1u 7.3u)\nR1 1 2 1k\nC1 2 0 1n"), { stop: 5e-3 });
    expect(Date.now() - t0).toBeLessThan(2000);
    if (r.ok) expect(r.breakpoints).toBeGreaterThan(1000);
    else expect(r.error).toMatch(/matrix factorization|corners/);
  });

  test("a tangled 60-element circuit at 200 000 steps: finishes under the ceiling or is refused as too much work", () => {
    let seed = 7;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let q = "V1 b0 0 PULSE(0 1 0 1u 1u 1 2)\n";
    for (let i = 1; i < 30; i++) q += `R${i} b${Math.floor(rnd() * i)} b${i} 1k\n`;
    for (let i = 0; i < 30; i++) {
      const a = Math.floor(rnd() * 30);
      let b = Math.floor(rnd() * 30);
      if (b === a) b = (a + 1) % 30;
      q += `C${i} b${a} b${b} 1n\n`;
    }
    expect(net(q).length).toBe(60);
    const t0 = Date.now();
    const r = solveTransient(net(q), { stop: 0.2, step: 1e-6, probes: ["b1"] });
    expect(Date.now() - t0).toBeLessThan(1500);
    if (!r.ok) expect(r.error).toMatch(/more work than the transient tool allows/);
  });

  test("stop/step caps and non-finite inputs refuse up front", () => {
    const e = net(RC);
    for (const req of [{ stop: NaN }, { stop: Infinity }, { stop: -1 }, { stop: 1e-3, step: NaN }, { stop: 1e-3, step: -1e-6 }]) {
      const r = solveTransient(e, req);
      expect(r.ok).toBe(false);
    }
    const r = solveTransient(e, { stop: 1, step: 1e-9 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/the most is 200000/);
    expect(run({ stop: "1", step: "1n" }).text).toMatch(/the most is 200000/);
  });

  test("final-value wording: a sine never settles; a ramp in progress is named", () => {
    expect(run({ net: "V1 1 0 SIN(0 1 1k)\nR1 1 2 1k\nC1 2 0 1u", stop: "5m" }).text).toMatch(
      /not applicable; V1 is a sine, which never settles/,
    );
    expect(run({ net: "V1 1 0 PWL(0 0 10m 5)\nR1 1 2 1k\nC1 2 0 1u", stop: "5m" }).text).toMatch(
      /V1 is still ramping at the stop time/,
    );
  });

  test("every result draws, at the SVG's own size, contract-clean", () => {
    const o = run({});
    const p = (o.blocks ?? []).find((b) => b.kind === "plot");
    expect(p).toBeDefined();
    if (p && p.kind === "plot") {
      expect(p.svg).toMatch(new RegExp(`^<svg[^>]*width="${p.w}"`));
      expect(p.svg).toContain("Time (ms)");
      expect(p.svg).toContain("Voltage (V)");
      expect(p.svg).not.toMatch(/\d[eE][+-]?\d/);
    }
    expect(o.text).toMatch(/Method: trapezoidal with backward-Euler starts at discontinuities/);
    expect(o.text).toMatch(/Final-value check: V\(2\) settles to 5 V; DC operating point 5 V\./);
    contractClean(o.text);
  });
});

describe("review round 1", () => {
  /** circ-slow.js: a 58-inductor chain driven by an irregular PWL (R03). */
  function inductorChain(np: number): { text: string; t: number } {
    const pts: string[] = [];
    let t = 0;
    for (let i = 0; i < np; i++) {
      t += 1e-5 * (1 + ((i * 7919) % 97) / 101);
      pts.push(t.toPrecision(9), (i % 2).toString());
    }
    let text = `V1 1 0 PWL(0 0 ${pts.join(" ")})\n`;
    for (let i = 1; i < 59; i++) text += `L${i} ${i} ${i + 1} 1m\n`;
    text += "R1 59 0 10\n";
    return { text, t };
  }

  test.each([
    [360, 40000],
    [365, 2000],
    [360, 2000],
    [330, 2000],
    [200, 20000],
  ])("R03 one combined budget: inductor chain, %i PWL corners, step t/%i, finishes fast or is refused", (np, div) => {
    const { text, t } = inductorChain(np);
    const t0 = Date.now();
    const r = solveTransient(net(text), { stop: Number((t * 1.01).toPrecision(6)), step: Number((t / div).toPrecision(6)), probes: ["2"] });
    // about 300 ms bundled at the budget; jest on a loaded box is several times slower
    expect(Date.now() - t0).toBeLessThan(1500);
    if (!r.ok) expect(r.error).toMatch(/more work than the transient tool allows|different ways, and each needs its own/);
  });

  test("R03 the 620 ms case is now refused (both budgets near the cap)", () => {
    const { text, t } = inductorChain(360);
    const r = solveTransient(net(text), { stop: Number((t * 1.01).toPrecision(6)), step: Number((t / 40000).toPrecision(6)), probes: ["2"] });
    expect(r.ok).toBe(false);
  });

  test("R04 a resistor-only circuit driven by a fast triangle gets no ringing note", () => {
    const o = run({ net: "V1 1 0 PULSE(0 1 0 1u 1u 0 2u)\nR1 1 0 1", stop: "1m", step: "" });
    expect(o.ok).not.toBe(false);
    expect(o.text).not.toMatch(/flips up and down/);
    expect(o.text).not.toMatch(/time constant/);
  });

  test("R04 the same triangle into an RC (τ = 1 ms, much longer than the step) gets no ringing note either", () => {
    const o = run({ net: "V1 1 0 PULSE(0 1 0 1u 1u 0 2u)\nR1 1 2 1k\nC1 2 0 1u", stop: "1m" });
    expect(o.text).not.toMatch(/flips up and down/);
  });

  test.each(["NaN", "Infinity", "-Infinity", "undefined", "-", "1e999", "NaN NaN NaN NaN", "R1 NaN 0 1k", "INaN 0 1 1m", "Infinity 1 0 5", "V1 1 0 NaN"])(
    "R05 rubbish netlist %j: refused, no bare NaN/Infinity/undefined in the text",
    (bad) => {
      const o = run({ net: bad });
      expect(o.ok).toBe(false);
      const stripped = o.text.replace(/"[^"]*"/g, '""');
      expect(stripped).not.toMatch(/\bNaN\b|\bInfinity\b|\bundefined\b/);
      expect(o.text).not.toMatch(/a device model/);
    },
  );

  test.each(["stop", "step", "nodes"])("R05 rubbish in the %s field: refused, nothing echoed unquoted", (key) => {
    for (const bad of ["NaN", "Infinity", "-", "1e999", "undefined"]) {
      const o = run({ [key]: bad });
      expect(o.ok).toBe(false);
      expect(o.text.replace(/"[^"]*"/g, '""')).not.toMatch(/\bNaN\b|\bInfinity\b|\bundefined\b/);
    }
  });

  test("coarse step: a named accuracy note, not a refusal", () => {
    const o = run({ net: "V1 1 0 PULSE(0 5 1m 1n 1n 1 2)\nR1 1 2 1\nC1 2 0 1u", stop: "10m" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/more than a tenth of the shortest time constant this circuit appears to have \(about 1 µs, at C1\)/);
    expect(run({}).text).not.toMatch(/shortest time constant/);
    expect(run({ net: "V1 1 0 PULSE(0 1 0 1n 1n 1 2)\nR1 1 2 10\nL1 2 3 1m\nC1 3 0 1u", stop: "1m" }).text).not.toMatch(/shortest time constant/);
  });

  test("tiny signals read in nV", () => {
    const o = run({ net: "V1 1 0 PULSE(0 5n 0 1n 1n 1 2)\nR1 1 2 1k\nC1 2 0 1u", stop: "5m" });
    expect(o.text).toMatch(/Voltage \(nV\)|nV/);
    expect(o.text).toContain("V(1) = 5 nV");
    contractClean(o.text);
  });

  test("the time of a plateau's max is the first time it is reached", () => {
    const o = run({ net: "V1 1 0 PULSE(0 5 1m 1u 1u 1 2)\nR1 1 0 1k", stop: "5m" });
    expect(o.text).toMatch(/V\(1\): min 0 V at t = 0, max 5 V at t = 1\.001 ms/);
  });
});

describe("review round 2", () => {
  const RLC1 = "V1 1 0 PULSE(0 1 0 1u 1u 1 2)\nR1 1 2 1\nL1 2 3 1m\nC1 3 0 1u";
  /** The recommended step in the note, in seconds. */
  const recommended = (text: string): number => {
    const m = /A step of ([\d.]+) (s|ms|µs|ns|ps) or less/.exec(text);
    if (!m) throw new Error(`no recommendation in: ${text}`);
    return Number(m[1]) / ({ s: 1, ms: 1e3, µs: 1e6, ns: 1e9, ps: 1e12 } as Record<string, number>)[m[2]];
  };

  test.each(["150u", "100u", "50u"])("R2-05 R 1 Ω, L 1 mH, C 1 µF (rings every 199 µs) at step %s: note, recommending ≤ 4 µs", (step) => {
    const o = run({ net: RLC1, stop: "2m", step });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/period at which L1 and C1 appear to ring \(about 198\.7 µs\)/);
    expect(recommended(o.text)).toBeLessThanOrEqual(4e-6);
    contractClean(o.text);
  });

  test("R2-05 the same RLC at 2 µs: no coarse-step note", () => {
    const o = run({ net: RLC1, stop: "2m", step: "2u" });
    expect(o.text).not.toMatch(/fast detail may be smoothed/);
  });

  test("tiny spans read in fs and fV", () => {
    const o = run({ net: "V1 1 0 PULSE(0 5f 0 1f 1f 1 2)\nR1 1 2 1\nC1 2 0 1f", stop: "500f" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/0 to 500 fs/);
    expect(o.text).toContain("V(1) = 5 fV");
    contractClean(o.text);
  });
});

describe("review round 3", () => {
  const HIGHQ = "V1 1 0 PULSE(0 1 0 1u 1u 1 2)\nR1 1 2 0.1\nL1 2 3 1m\nC1 3 0 1u";
  test("R3-02 lightly damped ringing over 20 ms at 9.9 µs: a note; its recommended step is within 0.1 V of the closed form", () => {
    const o = run({ net: HIGHQ, stop: "20m", step: "9.9u" });
    expect(o.ok).not.toBe(false);
    const m = /A step of ([\d.]+) (ms|µs|ns) or less/.exec(o.text);
    if (!m) throw new Error(o.text);
    const rec = Number(m[1]) / ({ ms: 1e3, µs: 1e6, ns: 1e9 } as Record<string, number>)[m[2]];
    const r = tran(HIGHQ, { stop: 20e-3, step: rec, probes: ["3"] });
    const a = 0.1 / (2 * 1e-3);
    const wd = Math.sqrt(1 / (1e-3 * 1e-6) - a * a);
    const exact = (t0: number): number => {
      const t = t0 - 0.5e-6;
      return t <= 0 ? 0 : 1 - Math.exp(-a * t) * (Math.cos(wd * t) + (a / wd) * Math.sin(wd * t));
    };
    let err = 0;
    r.times.forEach((t, i) => (err = Math.max(err, Math.abs(r.probes[0].values[i] - exact(t)))));
    expect(err).toBeLessThan(0.1);
  });

  test("R3-02 the drift alone triggers the note (20 ms at 4 µs passes the T/20 test but drifts)", () => {
    const o = run({ net: HIGHQ, stop: "20m", step: "4u" });
    expect(o.text).toMatch(/appears to drift in phase by about [\d.]+ rad over the run/);
  });
});
