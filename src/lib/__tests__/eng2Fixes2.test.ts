/**
 * Engineering fix round 2 (fix2-eng2) — each confirmed reviewer defect pinned: engines directly, pane-literal fixes by
 * source scan (taskpane.ts cannot be imported in a test; the engFixes2193 / eng1Fixes2 way).
 *
 * Oracles (C:\Users\AlexanderSmith\jurislab-oracle-venv, scipy/numpy, recorded inline):
 *   t=np.linspace(0,30,300001); _,y=sg.step(([1],[1,3,3,1]),T=t); last |y−1|>0.02 → ts = 7.5167 s   ((s+1)³)
 *   fc = 1/(2π·99000·1e−7) = 16.0763 Hz; √(1e6·fc) = 4009.52 Hz          (op-amp differentiator defaults, GBW 1 MHz)
 *   C–R high-pass 1 µF, 1 kΩ: 1/(2πRC) = 159.155 Hz
 *   series RLC, output across R (L 10 mH, C 1 µF, R 100 Ω): f = √(f0² + (B/2)²) ∓ B/2 = 983.632 Hz, 2575.18 Hz
 *   base excitation ζ = 2, r = 4: T = √((1 + 16²)/((1 − 16)² + 16²)) = 0.730961; ζ = 0, r = 2: T = 1/3
 *   720×576 at 16:9, 1.33 content: 720·1.33/(16/9) = 538.65 storage pixels (pillarbox)
 */
import * as fs from "fs";
import * as path from "path";
import { analyzeOpamp } from "../opamp";
import {
  parseTf,
  analyzeStability,
  poleSide,
  clusterRoots,
  polyRoots,
  secondOrderMetrics,
  defaultResponseWindow,
  timeResponse,
  reportedTransient,
} from "../control";
import { TLINE_CALCS, portBalance, unilateralZeroReason } from "../tlineCalcs";
import { parseNetlist, frequencySweep, sweepPassbandCorners, parseHertz, parseValue } from "../circuit";
import { KALMAN_CALCS, markEmptyItems } from "../kalmanCalcs";
import { planarFk } from "../robotics";
import { forcedResponse } from "../vibration";
import { guardEngResult, hasNonFinite } from "../finiteResult";
import { cableDamping } from "../audio";
import { parseMeasured } from "../units";
import { fNumberLabel, exposureValue } from "../photometry";
import { vacuumShot, dragShot, chartLineSegments } from "../trajectory";
import { cctMcCamy } from "../colourspace";
import { parseKet, fmtState } from "../quantumCore";
import { baseExcitation, transmissibilityPeak } from "../randomVibration";
import { RANDOM_VIBRATION_CALCS } from "../randomVibrationCalcs";
import { fabryPerot } from "../laserPhysics";
import { truthTable, minimise } from "../logic";
import { aspect } from "../video";
import { designFilter } from "../filter";
import { hasBrokenNumber } from "../insertGate";
import type { AnalyzeOutput } from "../analyzeBlocks";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");
function toolSource(id: string): string {
  const start = PANE.indexOf(`id: "${id}",`);
  if (start < 0) throw new Error(`no tool ${id}`);
  const next = PANE.indexOf("\n    id: \"", start + 10);
  return PANE.slice(start, next < 0 ? undefined : next);
}
const textOf = (o: AnalyzeOutput): string => ((o as { text?: string }).text ?? "");
type Calc = { id: string; fields: { key: string; default: string }[]; compute: (r: (k: string) => string) => AnalyzeOutput };
function run(calcs: readonly Calc[], id: string, over: Record<string, string>): AnalyzeOutput {
  const c = calcs.find((x) => x.id === id);
  if (!c) throw new Error(`no calc ${id}`);
  const vals: Record<string, string> = {};
  for (const f of c.fields) vals[f.key] = f.default;
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
const tf = (num: string, den: string) => {
  const t = parseTf(num, den);
  if ("ok" in t) throw new Error(t.error);
  return t;
};

describe("1. Op-amp differentiator: capacitive input, rising noise gain, √(GBW·fc) bandwidth", () => {
  const r = analyzeOpamp({ config: "differentiator", rin: [0], rf: 99000, c: 1e-7, gbw: 1e6 });
  test("bandwidth ≈ √(GBW·fc), not GBW/1", () => {
    if (!r.ok) throw new Error(r.error);
    expect(r.cornerFrequency as number).toBeCloseTo(16.0763, 3);
    expect(r.bandwidth as number).toBeCloseTo(4009.52, 1);
    expect(r.capacitiveInput).toBe(true);
    expect(Number.isNaN(r.noiseGain)).toBe(true);
    expect(Number.isFinite(r.inputResistance)).toBe(false);
  });
  test("names the series-input-resistor stability caveat", () => {
    if (!r.ok) throw new Error(r.error);
    expect(r.notes.join(" ")).toMatch(/SERIES INPUT RESISTOR/);
    expect(r.notes.join(" ")).toMatch(/√\(GBW·fc\)/);
  });
  test("pane: no 'essentially infinite' / constant noise gain for the differentiator", () => {
    const src = toolSource("opamp");
    expect(src).toMatch(/Input impedance = 1\/\(jωC\), capacitive/);
    expect(src).toMatch(/Noise gain = 1 \+ jωRf·C/);
    expect(src).toMatch(/opamp:differentiator-limits/);
  });
  test("GBW typed with its unit", () => {
    expect(parseHertz("1 MHz", "GBW")).toEqual({ ok: true, value: 1e6 });
    expect(parseHertz("1MHz", "GBW")).toEqual({ ok: true, value: 1e6 });
    expect(parseHertz("100 kHz", "GBW")).toEqual({ ok: true, value: 1e5 });
    expect(parseHertz("1e6", "GBW")).toEqual({ ok: true, value: 1e6 });
    const amb = parseHertz("1mhz", "GBW");
    expect(amb.ok).toBe(false);
    expect(toolSource("opamp")).toMatch(/parseHertz\(r\("gbw"\)/);
  });
});

describe("2. Poles on the imaginary axis are tagged so, at the stability tolerance", () => {
  test("re = 1.1×10⁻¹⁶ at ±1i is on the axis, not the right half plane", () => {
    expect(poleSide({ re: 1.1e-16, im: 1 })).toBe("on the imaginary axis");
    expect(poleSide({ re: -1e-17, im: 2 })).toBe("on the imaginary axis");
    expect(poleSide({ re: 0.5, im: 1 })).toBe("right half plane");
    expect(poleSide({ re: -0.5, im: 1 })).toBe("stable");
  });
  test("s² + 1 and s³ + s: every pole tag agrees with the verdict's axis count", () => {
    for (const den of ["s^2+1", "s^3+s", "s^4+5*s^2+4"]) {
      const st = analyzeStability(tf("1", den));
      if (!st.ok) throw new Error(st.error);
      expect(st.poles.filter((p) => poleSide(p) === "right half plane").length).toBe(st.rhpPolesNumeric);
      expect(st.poles.filter((p) => poleSide(p) === "on the imaginary axis").length).toBe(st.imaginaryAxisPoles);
    }
    expect(toolSource("control-tf")).toMatch(/const tag = poleSide\(p\);/);
  });
});

describe("3. Repeated real poles: critically damped, window sized by multiplicity", () => {
  test("(s+1)³ clusters to one triple real root at −1", () => {
    const c = clusterRoots(polyRoots(tf("1", "s^3+3*s^2+3*s+1").den) ?? []);
    expect(c).toHaveLength(1);
    expect(c[0].m).toBe(3);
    expect(c[0].im).toBe(0);
    expect(c[0].re).toBeCloseTo(-1, 9);
  });
  test("distinct poles stay distinct; a repeated complex pair clusters in pairs", () => {
    expect(clusterRoots(polyRoots(tf("1", "s^3+6*s^2+11*s+6").den) ?? []).map((c) => c.m)).toEqual([1, 1, 1]);
    const c2 = clusterRoots(polyRoots(tf("1", "s^4+4*s^3+8*s^2+8*s+4").den) ?? []);
    expect(c2.map((c) => c.m).sort()).toEqual([2, 2]);
  });
  test("(s+1)³: ζ = 1 critically damped, no damped frequency", () => {
    const m = secondOrderMetrics(tf("1", "s^3+3*s^2+3*s+1"));
    if (!m.ok) throw new Error(m.error);
    expect(m.zeta).toBe(1);
    expect(m.kind).toBe("critically damped");
    expect(m.wd).toBe(0);
    expect(m.wn).toBeCloseTo(1, 9);
  });
  test("window 12 s and the simulated 2 % settling time 7.52 s (scipy 7.5167)", () => {
    const g = tf("1", "s^3+3*s^2+3*s+1");
    const st = analyzeStability(g);
    if (!st.ok) throw new Error(st.error);
    const tEnd = defaultResponseWindow(st.poles);
    expect(tEnd).toBeCloseTo(12, 6);
    const res = timeResponse(g, "step", tEnd, 400);
    if (!res.ok) throw new Error(res.error);
    const tr = reportedTransient(secondOrderMetrics(g), res, "step");
    expect(tr.source).toBe("simulated");
    expect(tr.settlingTime as number).toBeCloseTo(7.5167, 1);
    expect(defaultResponseWindow(analyzeStability(tf("4", "s^2+2*s+4")).ok ? (analyzeStability(tf("4", "s^2+2*s+4")) as { poles: { re: number; im: number }[] }).poles : [])).toBeCloseTo(6, 9);
    expect(toolSource("control-step")).toMatch(/defaultResponseWindow\(st\.poles\)/);
  });
});

describe("4–5. Two-port: the real reason U = 0, and gain stated as a magnitude", () => {
  test("S11 = S22 = 0, S12 = S21 = 1∠−90°: U = 0 because both ports are matched", () => {
    const o = run(TLINE_CALCS as unknown as Calc[], "tl-two-port", { fmt: "ma", s: "S11 0 0\nS21 1 -90\nS12 1 -90\nS22 0 0" });
    const t = textOf(o);
    expect(t).toMatch(/U = 0 because S₁₁ = S₂₂ = 0: both ports are already matched to Z₀/);
    expect(t).not.toMatch(/U = 0: S₁₂ = 0/);
  });
  test("reason helper names S₁₂ = 0 as unilateral", () => {
    const z = { re: 0, im: 0 };
    const h = { re: 0.5, im: 0 };
    expect(unilateralZeroReason(h, h, z, h)).toMatch(/S₁₂ = 0: the device is unilateral/);
    expect(unilateralZeroReason(z, h, h, h)).toMatch(/port 1 is already matched/);
  });
  test("a negative balance is printed as a positive percentage of gain", () => {
    expect(portBalance(-4.38975)).toBe("438.975 % more comes out than goes in (gain)");
    expect(portBalance(0.25)).toBe("25 % is dissipated");
    const t = textOf(run(TLINE_CALCS as unknown as Calc[], "tl-two-port", {}));
    expect(t).not.toMatch(/[−-]\d[\d.]* % is added/);
  });
});

describe("6. AC sweep −3 dB points from the passband", () => {
  const corners = (net: string, f1 = 1, f2 = 1e5) => {
    const p = parseNetlist(net);
    const sw = frequencySweep(p.elements, "2", f1, f2, 160);
    if ("ok" in sw) throw new Error("sweep");
    return sweepPassbandCorners(p.elements, "2", sw.points);
  };
  test("C–R high-pass 1 µF / 1 kΩ swept 1 Hz–100 kHz: 159.15 Hz, rising", () => {
    const c = corners("V1 1 0 1\nC1 1 2 1u\nR1 2 0 1k");
    expect(c?.basis).toBe("high-frequency level");
    expect(c?.crossings).toHaveLength(1);
    expect(c?.crossings[0].rising).toBe(true);
    expect(c?.crossings[0].f as number).toBeCloseTo(159.155, 1);
  });
  test("R–C low-pass keeps 159.15 Hz, falling, from the low-frequency level", () => {
    const c = corners("V1 1 0 1\nR1 1 2 1k\nC1 2 0 1u");
    expect(c?.basis).toBe("low-frequency level");
    expect(c?.crossings[0].rising).toBe(false);
    expect(Math.abs((c?.crossings[0].f as number) / 159.155 - 1)).toBeLessThan(1e-3);
  });
  test("series RLC across R: both −3 dB points around the peak (983.63, 2575.18 Hz)", () => {
    const p = parseNetlist("V1 1 0 1\nL1 1 3 10m\nC1 3 2 1u\nR1 2 0 100");
    const sw = frequencySweep(p.elements, "2", 10, 1e5, 160);
    if ("ok" in sw) throw new Error("sweep");
    const c = sweepPassbandCorners(p.elements, "2", sw.points);
    expect(c?.basis).toBe("peak");
    expect(c?.crossings.map((x) => x.rising)).toEqual([true, false]);
    expect(c?.crossings[0].f as number).toBeCloseTo(983.632, 1);
    expect(c?.crossings[1].f as number).toBeCloseTo(2575.18, 0);
  });
  test("pane labels lower/upper points and draws a flat response flat", () => {
    const src = toolSource("circuit-ac");
    expect(src).toMatch(/lower −3 dB point/);
    expect(src).toMatch(/Math\.max\(\.\.\.finiteDb\) - Math\.min\(\.\.\.finiteDb\) < 1e-9/);
    expect(src).toMatch(/flat: the magnitude does not change/);
  });
});

describe("7. Kalman: an empty item is a missing sample", () => {
  test("markEmptyItems", () => {
    expect(markEmptyItems("1, 2, , 4")).toEqual({ text: "1, 2, -, 4", count: 1 });
    expect(markEmptyItems("1,2,,4").count).toBe(0); // bare commas already keep the empty cell
    expect(markEmptyItems("1, 2, 3").count).toBe(0);
  });
  test("'1, 2, , 4' runs four steps with one missing, like NaN", () => {
    const calcs = KALMAN_CALCS as unknown as Calc[];
    const a = textOf(run(calcs, "kalman-run", { model: "cv", data: "1, 2, , 4" }));
    const b = textOf(run(calcs, "kalman-run", { model: "cv", data: "1, 2, NaN, 4" }));
    expect(a).toMatch(/run over 4 samples/);
    expect(a).toMatch(/empty item between commas was read as a missing sample/);
    // The note must survive the central guard (an earlier draft said "like NaN" and the pane refused the result).
    expect(guardEngResult(run(calcs, "kalman-run", { model: "cv", data: "1, 2, , 4" })).ok).not.toBe(false);
    const fin = (s: string) => /Final estimate: ([^\n]*)/.exec(s)?.[1];
    expect(fin(a)).toBe(fin(b));
  });
});

describe("8. comp-float at v = 0", () => {
  test("relative spacing is undefined, said in words, not 0", () => {
    const src = toolSource("comp-float");
    expect(src).toMatch(/v === 0 \? "undefined \(relative spacing at 0/);
    expect(hasBrokenNumber("Relative spacing at 0\tundefined (relative spacing at 0: ULP ÷ |v| divides by zero)")).toBe(false);
  });
});

describe("9. Rounding noise", () => {
  test("robotics-fk L = 1, 1; A = 90°, 90°: J1 x is exactly 0", () => {
    const r = planarFk([1, 1], [Math.PI / 2, Math.PI / 2]);
    if (!r) throw new Error("fk");
    expect(r.joints[1].x).toBe(0);
    expect(r.joints[1].y).toBe(1);
    expect(r.tip.x).toBeCloseTo(-1, 15);
    expect(r.tip.y).toBeCloseTo(1, 15);
  });
});

describe("10. No ok result carries a non-finite number", () => {
  test("vib-forced ζ = 0 at r = 1 is refused by name; ζ = 0 elsewhere has no Infinity", () => {
    const r = forcedResponse(1, 100, 0, 10, 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Resonance with no damping.*unbounded/);
    const r2 = forcedResponse(1, 100, 0, 10, 20);
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.peakMagnification).toBeNull();
  });
  test("guardEngResult: 'not finite' / Infinity text refused, NaN outputs dropped, refusals untouched", () => {
    expect(guardEngResult({ text: "Setup not finite PASS", ok: true }).ok).toBe(false);
    expect(guardEngResult({ text: "order Infinity", ok: true }).ok).toBe(false);
    const kept = guardEngResult({ text: "x = 1", ok: true, outputs: [{ key: "a", label: "a", value: NaN, unit: "" }, { key: "b", label: "b", value: 2, unit: "" }] });
    expect(kept.ok).not.toBe(false);
    expect(kept.outputs?.map((o) => o.key)).toEqual(["b"]);
    expect(hasNonFinite(kept)).toBe(false);
    const refusal = { text: "Give a value: \"Infinity\" is not one.", ok: false } as AnalyzeOutput;
    expect(guardEngResult(refusal)).toBe(refusal);
  });
  test("filter-design at 1e300 dB names an unbounded order, never 'order Infinity'", () => {
    const r = designFilter({ family: "butterworth", kind: "lowpass", wp: 1, ws: 2, ap: 1, as: 1e300 } as Parameters<typeof designFilter>[0]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/an unbounded order/);
      expect(hasBrokenNumber(r.error)).toBe(false);
    }
  });
  test("the guard wraps every ENG_CALCS compute centrally", () => {
    expect(PANE).toMatch(/for \(const c of ENG_CALCS\) \{\n  const raw = c\.compute;\n  c\.compute = \(read\) => tidyResultSubscripts\(guardEngResult\(raw\(read\)\)\);/);
  });
});

describe("11. Display contract in notes, refusals and figure labels", () => {
  test("AWG note has no caret", () => {
    const r = cableDamping({ loadOhm: 8, sourceOhm: 0, lengthM: 10, awg: 14 });
    if (!r.ok) throw new Error((r as { error: string }).error);
    expect(r.notes.join(" ")).toMatch(/92 to the power \(36 − n\)\/39/);
    expect(r.notes.join(" ")).not.toMatch(/\^/);
  });
  test("unit mismatch names m³ and kg/m³, not carets", () => {
    const a = parseMeasured("5 kg", "m^3");
    const b = parseMeasured("5 kg", "kg/m^3");
    expect("error" in a && a.error).toMatch(/not compatible with m³/);
    expect("error" in b && b.error).toMatch(/not compatible with kg\/m³/);
  });
  test("optics-gaussian: M² in its refusal and label, ±zR in the figure", () => {
    const src = toolSource("optics-gaussian");
    expect(src).not.toMatch(/M\^2/);
    expect(src).not.toMatch(/"z_R"/);
    expect(src).toMatch(/label: "±zR"/);
  });
  test("f-numbers in figures are their markings", () => {
    expect(fNumberLabel(2 * Math.SQRT2)).toBe("2.8");
    expect(fNumberLabel(4 * Math.SQRT2)).toBe("5.6");
    expect(fNumberLabel(16 * Math.SQRT2)).toBe("22");
    expect(fNumberLabel(8)).toBe("8");
    expect(fNumberLabel(3.3)).toBe("3.3");
    const e = exposureValue(2 * Math.SQRT2, 1 / 125, 100);
    if (!e.ok) throw new Error(e.error);
    expect(e.figure.title).toBe("Shutter time against scene EV at f/2.8, ISO 100");
    expect(e.figure.series[0].label).toBe("f/2.8, ISO 100");
  });
});

describe("12. Refusal minus signs and no negative zero", () => {
  test("trajectory, atmosphere and correlation refusals use U+2212", () => {
    const v = vacuumShot(10, 95);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toMatch(/between −90 and 90/);
    expect(PANE).toMatch(/defined from −5 km to 84\.852 km/);
    expect(PANE).toMatch(/must lie between −1 and \+1/);
    expect(PANE).not.toMatch(/between -1 and \+1/);
  });
  test("Duv of a point on the locus prints 0.0000, never −0.0000", () => {
    // Planckian 2856 K (illuminant A) chromaticity: Duv ≈ 0.
    const r = cctMcCamy(0.44757, 0.40745);
    if (!r.ok) throw new Error((r as { error: string }).error);
    expect(r.notes.join(" ")).not.toMatch(/Duv [−-]0\.0000/);
    expect(r.notes.join(" ")).toMatch(/Duv 0\.0000/);
  });
});

describe("13. Great-circle chart line takes the short way across the antimeridian", () => {
  test("LAX → SYD splits at −180°", () => {
    const segs = chartLineSegments(33.9425, -118.408, -33.9461, 151.177);
    expect(segs).toHaveLength(2);
    expect(segs[0][0].x).toBeCloseTo(-118.408, 6);
    expect(segs[0][1].x).toBe(-180);
    expect(segs[1][0].x).toBe(180);
    expect(segs[1][1].x).toBeCloseTo(151.177, 6);
    expect(segs[0][1].y).toBeCloseTo(segs[1][0].y, 12);
    // Every point stays inside ±180 (nothing through longitude 0).
    for (const s of segs) for (const p of s) expect(Math.abs(p.x)).toBeLessThanOrEqual(180);
  });
  test("LHR → JFK is one segment", () => {
    expect(chartLineSegments(51.4775, -0.4614, 40.6413, -73.7781)).toHaveLength(1);
    expect(toolSource("nav-greatcircle")).toMatch(/chartLineSegments\(vals\[0\], vals\[1\], vals\[2\], vals\[3\]\)/);
  });
});

describe("14. Wrong refusals now accepted", () => {
  test("parseKet reads its own output form and ⊗ products", () => {
    const a = parseKet("(|0⟩ + |1⟩)/√2");
    if ("error" in a) throw new Error(a.error);
    expect(a.n).toBe(1);
    expect(a.state[0].re).toBeCloseTo(Math.SQRT1_2, 12);
    expect(a.state[1].re).toBeCloseTo(Math.SQRT1_2, 12);
    expect(a.notes).toEqual([]);
    for (const s of ["(|0⟩ + |1⟩)/sqrt(2)", "1/√2(|0⟩ + |1⟩)", "(|00⟩ + |11⟩)/√2", "1/√2|0⟩ + 1/√2|1⟩"]) {
      const r = parseKet(s);
      if ("error" in r) throw new Error(`${s}: ${r.error}`);
      expect(r.notes).toEqual([]);
    }
    const p = parseKet("(|0⟩ − |1⟩)/2");
    if ("error" in p) throw new Error(p.error);
    expect(p.state[1].re).toBeCloseTo(-Math.SQRT1_2, 12);
    const t = parseKet("|0⟩⊗|+⟩");
    if ("error" in t) throw new Error(t.error);
    expect(t.n).toBe(2);
    expect(t.state.map((z) => Number(z.re.toFixed(9)))).toEqual([0.707106781, 0.707106781, 0, 0]);
    const t3 = parseKet("|1⟩ ⊗ |0⟩ ⊗ |1⟩");
    if ("error" in t3) throw new Error(t3.error);
    expect(t3.n).toBe(3);
    expect(t3.state[5].re).toBeCloseTo(1, 12);
    expect("error" in parseKet("(|0⟩ + |1⟩")).toBe(true);
  });
  test("round trip: whatever fmtState prints, parseKet reads back (up to global phase)", () => {
    const s = Math.SQRT1_2;
    const e = (th: number, k = 1) => ({ re: k * Math.cos(th), im: k * Math.sin(th) });
    const states: { re: number; im: number }[][] = [
      [e(0, s), e(0, s)],
      [e(0, Math.sqrt(3) / 2), e(0, 0.5)],
      [e(Math.PI / 4, s), e(-Math.PI / 4, s)], // printed with a factored global phase exp(iπ/4)·(…)
      [e(0, 0.6), e(Math.PI / 2, 0.8)],
      [e(0, s), e(0, 0), e(0, 0), e(Math.PI, s)],
      [e(0.3, 0.6), e(1.1, 0.8)],
    ];
    for (const st of states) {
      const n = Math.log2(st.length);
      const shown = fmtState(st, n).text;
      const back = parseKet(shown);
      if ("error" in back) throw new Error(`${shown}: ${back.error}`);
      let re = 0, im = 0;
      st.forEach((a, i) => {
        const b = back.state[i];
        re += a.re * b.re + a.im * b.im;
        im += a.re * b.im - a.im * b.re;
      });
      expect(Math.hypot(re, im)).toBeCloseTo(1, 5);
    }
  });
  test("base excitation: ζ ≥ 1 and ζ = 0 (away from r = 1) accepted", () => {
    const over = baseExcitation(25, 2, 100, { kind: "acc", amplitude: 9.80665 });
    if (!over.ok) throw new Error(over.error);
    expect(over.T).toBeCloseTo(0.730961, 5);
    const und = baseExcitation(25, 0, 50, { kind: "acc", amplitude: 9.80665 });
    if (!und.ok) throw new Error(und.error);
    expect(und.T).toBeCloseTo(1 / 3, 12);
    expect(transmissibilityPeak(0)).toEqual({ r: 1, T: Infinity });
    const res = baseExcitation(25, 0, 25, { kind: "acc", amplitude: 9.80665 });
    expect(res.ok).toBe(false);
    const o = run(RANDOM_VIBRATION_CALCS as unknown as Calc[], "vib-base-excitation", { dkind: "zeta", damp: "0", f: "50" });
    expect(o.ok).not.toBe(false);
    expect(textOf(o)).toMatch(/unbounded/);
    expect(hasBrokenNumber(textOf(o))).toBe(false);
    expect(run(RANDOM_VIBRATION_CALCS as unknown as Calc[], "vib-base-excitation", { dkind: "zeta", damp: "1.5" }).ok).not.toBe(false);
  });
  test("netlist values with U+2212 and Ω; an 'M' resistor is noted as milli", () => {
    const p = parseNetlist("V1 1 0 −5\nR1 1 2 1kΩ\nR2 2 0 1M");
    expect(p.errors).toEqual([]);
    expect(p.elements[0].value).toBe(-5);
    expect(p.elements[1].value).toBe(1000);
    expect(p.elements[2].value).toBeCloseTo(1e-3, 15);
    expect(p.notes.join(" ")).toMatch(/R2 = 1M is read as 0\.001 \(M is MILLI in SPICE notation\)\. For mega write MEG/);
    expect(parseNetlist("R1 1 0 1MEG\nV1 1 0 1").notes).toEqual([]);
    expect(parseValue("4.7kohm")?.value).toBe(4700);
  });
  test("traj-drag at exactly 90° is a vertical launch", () => {
    const d = dragShot(30, 90, 0.1, 0.001, 0.47, 0);
    if (!d.ok) throw new Error(d.error);
    expect(d.rangeM).toBe(0);
    expect(d.apexM).toBeGreaterThan(0);
    const v = vacuumShot(30, 90);
    if (!v.ok) throw new Error(v.error);
    expect(v.rangeM).toBe(0);
  });
  test("Fabry–Pérot R = 1 is refused BY NAME (perfect mirror)", () => {
    const one = fabryPerot({ L: 0.1, n: 1, R1: 1, R2: 0.99, lambda: null });
    expect(one.ok).toBe(false);
    if (!one.ok) expect(one.error).toMatch(/R₁ = 1 is a perfect mirror: it transmits nothing/);
    const both = fabryPerot({ L: 0.1, n: 1, R1: 1, R2: 1, lambda: null });
    if (!both.ok) expect(both.error).toMatch(/finesse and photon lifetime are infinite/);
  });
  test("logic minterm notation Σm(…) / m(…) + d(…)", () => {
    const t = truthTable("m(1,3,5,7)", "A B C");
    if (!t.ok) throw new Error(t.error);
    expect(t.minterms).toEqual([1, 3, 5, 7]);
    const m = minimise(t.minterms, t.variables, []);
    if (!m.ok) throw new Error(m.error);
    expect(m.expression).toBe("C");
    const s = truthTable("Σm(0, 2) + d(1)", "A B");
    if (!s.ok) throw new Error(s.error);
    expect(s.minterms).toEqual([0, 2]);
    expect(s.dontCares).toEqual([1]);
    expect(truthTable("m(9)", "A B C").ok).toBe(false);
    expect(toolSource("logic")).toMatch(/t\.dontCares/);
  });
});

describe("Suspicion: anamorphic SD frames fit content to the display aspect", () => {
  test("720×576 at 16:9 with 1.33 content pillarboxes to 538.65 storage pixels", () => {
    const r = aspect({ width: 720, height: 576, dar: "16:9", frame: "720×576", content: "1.33" });
    if (!r.ok) throw new Error(r.error);
    expect(r.framing?.kind).toBe("pillarbox");
    expect(r.framing?.activeExact as number).toBeCloseTo(538.65, 6);
    expect(r.notes.join(" ")).toMatch(/pixels are not square/);
  });
  test("square-pixel 1080p is unchanged (1.85 → 1037.84 lines)", () => {
    const r = aspect({ width: 1920, height: 1080, par: "1", frame: "1920×1080", content: "1.85" });
    if (!r.ok) throw new Error(r.error);
    expect(r.framing?.kind).toBe("letterbox");
    expect(r.framing?.activeExact as number).toBeCloseTo(1037.838, 3);
  });
});
