/**
 * Engineering fix round 2.193 — each confirmed reviewer defect pinned (engines directly; pane-literal fixes by
 * source scan, the engineeringRouting.test.ts way, since taskpane.ts cannot be imported in a test).
 *
 * Oracles (C:\Users\AlexanderSmith\jurislab-oracle-venv, recorded inline):
 *  - kd: Shigley Eq. 6-27 evaluated in Python: 400 °C (752 °F) → 0.9015, 200 °C (392 °F) → 1.0162.
 *  - water p_sat: CoolProp 8.0.0 PropsSI('P','T',T,'Q',0,'Water'): 80 °C → 47414.47 Pa, 20 °C → 2339.32 Pa.
 *  - PK ka = k: numeric superposition of F·D·k/V·t·e^(−kt) over 400 doses, D 500, V 35, CL 3.5, τ 12:
 *    peak 12.6146 at 4.8278 h, trough 10.5735, fluctuation 0.19305.
 *  - control: scipy.signal.step on 200001 points: (s+1)/(s²+2s+4) overshoot 0.69936, 4/(s²+2s+4) 0.16303.
 */
import * as fs from "fs";
import * as path from "path";
import { temperatureFactorKd, enduranceLimit, finiteLife, minerDamage } from "../fatigue";
import { waterVapourPressure, waterNpshVapourPressure, npshAnalysis } from "../fluids";
import { multiAxisMove, greatCircle, type AxisSpec } from "../trajectory";
import { steadyState } from "../pk";
import { parseTf, secondOrderMetrics, timeResponse, reportedTransient, stepMetricsFromResponse, transientNotes } from "../control";
import { parseNetlist, frequencySweep, sweepCorner3dB, parseFieldValue } from "../circuit";
import { parseUncertainty, fieldUnitOf } from "../engWorkbench";
import { resonator } from "../optics";
import { tidyDisplay, tidySvgText, tidyResultSubscripts, snapNoise, snapGroup } from "../subscriptText";
import type { AnalyzeOutput } from "../analyzeBlocks";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");
/** The source of one ENG_CALCS entry, from its id to the next entry. */
function toolSource(id: string): string {
  const start = PANE.indexOf(`id: "${id}",`);
  if (start < 0) throw new Error(`no tool ${id}`);
  const next = PANE.indexOf("\n    id: \"", start + 10);
  return PANE.slice(start, next < 0 ? undefined : next);
}

const BASE_E = {
  sut: 700,
  materialClass: "steel" as const,
  surface: "machined" as const,
  diameter: 25,
  load: "bending" as const,
  tempC: 20,
  reliability: 0.5,
};

describe("1. Marin temperature factor kd (Shigley Eq. 6-27)", () => {
  test.each([
    [400, 0.9015],
    [200, 1.0162],
    [100, 1.0236],
    [300, 0.9768],
  ])("%p °C → kd %p", (t, kd) => {
    expect(temperatureFactorKd(t)).toBeCloseTo(kd, 3);
  });
  test("agrees with Table 6-4 to within 0.005 where the task quotes it (400 °C 0.900, 200 °C 1.020)", () => {
    expect(Math.abs((temperatureFactorKd(400) as number) - 0.9)).toBeLessThan(0.005);
    expect(Math.abs((temperatureFactorKd(200) as number) - 1.02)).toBeLessThan(0.005);
  });
  test("held at 1 at and below room temperature; null above 1000 °F", () => {
    expect(temperatureFactorKd(20)).toBe(1);
    expect(temperatureFactorKd(-60)).toBe(1);
    expect(temperatureFactorKd(538)).toBeNull();
    expect(temperatureFactorKd(NaN)).toBeNull();
  });
  test("enduranceLimit uses it, and the invented linear derating is gone", () => {
    const r = enduranceLimit({ ...BASE_E, tempC: 200 });
    if (!r.ok) throw new Error(r.error);
    expect(r.kd).toBeCloseTo(1.0162, 3);
    expect(r.notes.join(" ")).toMatch(/Eq\. 6-27/);
    expect(fs.readFileSync(path.join(__dirname, "..", "fatigue.ts"), "utf8")).not.toMatch(/0\.0006 \* \(tempC/);
    const hot = enduranceLimit({ ...BASE_E, tempC: 400 });
    if (!hot.ok) throw new Error(hot.error);
    expect(hot.kd).toBeCloseTo(0.9015, 3);
    expect(enduranceLimit({ ...BASE_E, tempC: 460 }).ok).toBe(false); // creep, as before
  });
});

describe("2. Pump NPSH: vapour pressure consistent with the water temperature", () => {
  test("saturation table matches CoolProp", () => {
    expect((waterVapourPressure(80) as number) / 47414.47).toBeCloseTo(1, 3);
    expect((waterVapourPressure(20) as number) / 2339.32).toBeCloseTo(1, 3);
    // 72.5 °C is mid-interval; CoolProp gives 34 732 Pa (within the documented 0.19 %).
    expect(Math.abs((waterVapourPressure(72.5) as number) / 34732.4 - 1)).toBeLessThan(0.0019);
    expect(waterVapourPressure(101)).toBeNull();
  });
  test("water at 80 °C with the untouched 20 °C default: table value, NPSHa 7.16 m", () => {
    const pv = waterNpshVapourPressure(80, "2339", 2339);
    if (!pv.ok) throw new Error(pv.error);
    expect(pv.pv).toBeCloseTo(47414, -1);
    const res = npshAnalysis({ pSurface: 101325, pVapour: pv.pv, rho: 971.8, staticHead: 2, suctionLosses: 0.5, npshRequired: 3 });
    if (!res.ok) throw new Error(res.error);
    expect(res.npshAvailable).toBeCloseTo(7.16, 2);
  });
  test("blank takes the table; a close typed value is accepted; a contradicting one is refused by name", () => {
    expect(waterNpshVapourPressure(80, "", NaN).ok).toBe(true);
    expect(waterNpshVapourPressure(80, "47.5 kPa", 47500).ok).toBe(true);
    const bad = waterNpshVapourPressure(80, "30000", 30000);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/does not match water at 80 °C/);
  });
  test("pane: the water source routes through the helper and the false 'not filled in' note is gone", () => {
    const src = toolSource("pump-npsh");
    expect(src).toMatch(/waterNpshVapourPressure\(tempC/);
    expect(src).not.toMatch(/deliberately not filled in/);
  });
});

describe("3. Multi-axis coordination draws a straight line", () => {
  /** Position of a trapezoid/triangle profile (distance d, limits v, a) at time t. */
  function pos(d: number, v: number, a: number, t: number): number {
    const vp = Math.min(v, Math.sqrt(a * d));
    const ta = vp / a;
    const tc = Math.max(0, (d - vp * ta) / vp);
    const T = 2 * ta + tc;
    if (t <= 0) return 0;
    if (t >= T) return d;
    if (t < ta) return 0.5 * a * t * t;
    if (t < ta + tc) return 0.5 * a * ta * ta + vp * (t - ta);
    const td = T - t;
    return d - 0.5 * a * td * td;
  }
  function checkStraight(axes: AxisSpec[]): number {
    const r = multiAxisMove(axes);
    if (!r.ok) throw new Error(r.error);
    for (const [i, p] of r.axes.entries()) {
      expect(p.scaledVmax).toBeLessThanOrEqual(axes[i].vmax * (1 + 1e-12));
      expect(p.scaledAmax).toBeLessThanOrEqual(axes[i].amax * (1 + 1e-12));
    }
    const moving = r.axes.filter((p) => p.distanceM > 0);
    for (let k = 0; k <= 50; k++) {
      const t = (r.moveTimeS * k) / 50;
      const fr = moving.map((p) => pos(p.distanceM, p.scaledVmax, p.scaledAmax, t) / p.distanceM);
      for (const f of fr) expect(f).toBeCloseTo(fr[0], 9);
    }
    // Every axis finishes exactly at the move time.
    for (const p of moving) expect(pos(p.distanceM, p.scaledVmax, p.scaledAmax, r.moveTimeS * (1 - 1e-12))).toBeCloseTo(p.distanceM, 6);
    return r.moveTimeS;
  }
  test("the default move: X limits both, 1.5 s, straight", () => {
    expect(checkStraight([
      { label: "X", distanceM: 1, vmax: 1, amax: 2 },
      { label: "Y", distanceM: 0.2, vmax: 1, amax: 2 },
      { label: "Z", distanceM: 0.05, vmax: 0.3, amax: 1 },
    ])).toBeCloseTo(1.5, 12);
  });
  test("speed and acceleration limited by different axes: straight, and the extra time is stated", () => {
    const axes = [
      { label: "X", distanceM: 1, vmax: 0.5, amax: 100 },
      { label: "Y", distanceM: 1, vmax: 100, amax: 1 },
    ];
    expect(checkStraight(axes)).toBeCloseTo(2.5, 12);
    const r = multiAxisMove(axes);
    if (!r.ok) throw new Error(r.error);
    expect(r.notes.join(" ")).toMatch(/longer than the slowest axis/);
    expect(r.notes.join(" ")).not.toMatch(/COSTS NOTHING/);
  });
  test("a triangular move and a zero-distance axis", () => {
    checkStraight([
      { label: "X", distanceM: 0.01, vmax: 1, amax: 2 },
      { label: "Y", distanceM: 0.004, vmax: 1, amax: 0.5 },
      { label: "Z", distanceM: 0, vmax: 1, amax: 1 },
    ]);
  });
});

describe("4. PK steady state at ka = ke uses the exact limit", () => {
  const p = { dose: 500, vd: 35, cl: 3.5, f: 1, ka: 0.1 };
  test("reviewer case: trough 10.57, peak 12.61 at 4.83 h, fluctuation 19 %", () => {
    const r = steadyState(p, 12);
    if (!r.ok) throw new Error(r.error);
    expect(r.cMinSs).toBeCloseTo(10.5735, 3);
    expect(r.cMaxSs).toBeCloseTo(12.6146, 3);
    expect(r.tMaxSs as number).toBeCloseTo(4.8279, 3);
    expect(r.fluctuation as number).toBeCloseTo(0.19305, 4);
    expect(r.notes.join(" ")).not.toMatch(/upper bound/);
  });
  test("continuous with the general solution either side of ka = ke", () => {
    const r0 = steadyState(p, 12);
    if (!r0.ok) throw new Error(r0.error);
    for (const s of [1 - 1e-5, 1 + 1e-5, 1 - 1e-6, 1 + 1e-6]) {
      const r = steadyState({ ...p, ka: 0.1 * s }, 12);
      if (!r.ok) throw new Error(r.error);
      expect(r.cMinSs / r0.cMinSs).toBeCloseTo(1, 4);
      expect(r.cMaxSs / r0.cMaxSs).toBeCloseTo(1, 4);
    }
  });
});

describe("5. Fatigue life: stress at or above Sut is static failure", () => {
  test("refused by name, single and in a spectrum", () => {
    const r = finiteLife(700, 250, 700);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/STATIC FAILURE/);
    expect(finiteLife(800, 250, 700).ok).toBe(false);
    expect(finiteLife(650, 250, 700).ok).toBe(true); // low-cycle, still a stress-life estimate with its note
    const m = minerDamage([{ sigmaA: 420, cycles: 1000 }, { sigmaA: 800, cycles: 1 }], 250, 700);
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.error).toMatch(/^Block 2: STATIC FAILURE/);
  });
});

describe("6. Control: 'exact' only without zeros; impulse has no step metrics", () => {
  const tfZero = parseTf("s+1", "s^2+2*s+4");
  const tfPure = parseTf("4", "s^2+2*s+4");
  if ("ok" in tfZero || "ok" in tfPure) throw new Error("parse");
  test("a zero makes it not exact; a constant numerator is exact", () => {
    const mz = secondOrderMetrics(tfZero);
    const mp = secondOrderMetrics(tfPure);
    if (!mz.ok || !mp.ok) throw new Error("metrics");
    expect(mz.exact).toBe(false);
    expect(mz.notes.join(" ")).toMatch(/ZERO/);
    expect(mp.exact).toBe(true);
  });
  test("with a zero, the reported overshoot is the simulated 69.9 %, not 16.3 %", () => {
    const res = timeResponse(tfZero, "step", 6, 400);
    if (!res.ok) throw new Error(res.error);
    const tr = reportedTransient(secondOrderMetrics(tfZero), res, "step");
    expect(tr.source).toBe("simulated");
    expect(tr.overshoot as number).toBeCloseTo(0.699, 2);
    expect(tr.riseLabel).toBe("10–90 %");
    expect(tr.settlingTime as number).toBeGreaterThan(3.6);
    expect(tr.settlingTime as number).toBeLessThan(3.8);
  });
  test("without a zero, the closed form is kept (16.3 %)", () => {
    const res = timeResponse(tfPure, "step", 6, 400);
    if (!res.ok) throw new Error(res.error);
    const tr = reportedTransient(secondOrderMetrics(tfPure), res, "step");
    expect(tr.source).toBe("exact");
    expect(tr.overshoot as number).toBeCloseTo(0.163, 3);
  });
  test("caveats about unprinted closed-form numbers are dropped for a measured report", () => {
    const mz = secondOrderMetrics(tfZero);
    if (!mz.ok) throw new Error("metrics");
    const kept = transientNotes(mz, "simulated").join(" ");
    expect(kept).toMatch(/ZERO/);
    expect(kept).not.toMatch(/formulas above are derived|envelope estimate/);
  });
  test("impulse: no step metrics at all", () => {
    const res = timeResponse(tfPure, "impulse", 6, 400);
    if (!res.ok) throw new Error(res.error);
    const tr = reportedTransient(secondOrderMetrics(tfPure), res, "impulse");
    expect(tr).toMatchObject({ source: "none", overshoot: null, settlingTime: null, peakTime: null });
  });
  test("stepMetricsFromResponse on a clean first-order trace", () => {
    const t = Array.from({ length: 2001 }, (_, i) => i * 0.005);
    const y = t.map((x) => 1 - Math.exp(-x));
    const m = stepMetricsFromResponse(t, y, 1);
    if (!m) throw new Error("null");
    expect(m.overshoot).toBe(0);
    expect(m.riseTime as number).toBeCloseTo(Math.log(9), 3);
    expect(m.settlingTime as number).toBeCloseTo(Math.log(50), 3);
    expect(stepMetricsFromResponse(t, y, 0)).toBeNull();
  });
  test("pane: step and PID tools print through reportedTransient", () => {
    expect(toolSource("control-step")).toMatch(/reportedTransient\(m, res, kind\)/);
    expect(toolSource("control-pid")).toMatch(/reportedTransient\(m, sim\.ok/);
  });
});

describe("7. AC sweep corner is solved, not the first sample past it", () => {
  test("RC 1 kΩ, 1 µF → 159.155 Hz", () => {
    const net = parseNetlist("V1 1 0 1\nR1 1 2 1k\nC1 2 0 1u");
    const sw = frequencySweep(net.elements, "2", 1, 100000, 160);
    if ("ok" in sw) throw new Error("sweep");
    const fc = sweepCorner3dB(net.elements, "2", sw.points, sw.points[0].magnitude);
    // The reference is the 1 Hz magnitude (not exactly 1), so the corner sits a hair from 1/(2πRC) = 159.155 Hz.
    expect(Math.abs((fc as number) / 159.155 - 1)).toBeLessThan(1e-3);
  });
  test("no corner in range → null", () => {
    const net = parseNetlist("V1 1 0 1\nR1 1 2 1k\nC1 2 0 1u");
    const sw = frequencySweep(net.elements, "2", 1, 50, 40);
    if ("ok" in sw) throw new Error("sweep");
    expect(sweepCorner3dB(net.elements, "2", sw.points, sw.points[0].magnitude)).toBeNull();
  });
  test("pane uses it", () => {
    expect(toolSource("circuit-ac")).toMatch(/sweepCorner3dB\(parsed\.elements, out, pts, ref\)/);
  });
});

// Superseded in fix2-eng1 (reviewer): a bare threshold is now read in MPa·√m, the unit the Paris C beside it is
// quoted for, and converted to Pa·√m for the engine; a typed unit still converts. See eng1Fixes2.test.ts.
describe("8. Paris threshold ΔK reads through the unit layer (bare = MPa·√m since fix2-eng1)", () => {
  test("source", () => {
    expect(toolSource("fracture-paris")).toMatch(/u\.opt\("dkth", "MPa\*m\^0\.5"/);
    expect(toolSource("fracture-paris")).toMatch(/deltaKthMPa \* 1e6/);
  });
});

describe("9. Op-amp fields take engineering suffixes", () => {
  test.each([
    ["100k", 1e5],
    ["99000", 99000],
    ["4.7n", 4.7e-9],
    ["2k2", 2200],
    ["1meg", 1e6],
    ["1e-7", 1e-7],
    ["10 kΩ", 1e4],
  ])("%p → %p", (t, v) => {
    const r = parseFieldValue(t, "R", true);
    if (!r.ok) throw new Error(r.error);
    expect(r.value).toBeCloseTo(v, 15);
  });
  test("ambiguous m/M on a resistor and run-together lists are refused", () => {
    expect(parseFieldValue("1M", "R", true).ok).toBe(false);
    expect(parseFieldValue("1m", "R", true).ok).toBe(false);
    expect(parseFieldValue("1000 2000", "R", true).ok).toBe(false);
    expect(parseFieldValue("abc", "R", true).ok).toBe(false);
    expect(parseFieldValue("1M", "GBW").ok).toBe(false);
    expect(parseFieldValue("1m", "C").ok).toBe(true);
  });
  test("pane reads every op-amp field through it", () => {
    const src = toolSource("opamp");
    expect(src).toMatch(/parseFieldValue\(part, "Input resistor", true\)/);
    expect(src).not.toMatch(/\.map\(Number\)/);
    expect(src).not.toMatch(/Number\(r\("rf"\)/);
  });
});

describe("10. Uncertainty on bare-number temperature fields", () => {
  const fields = [
    { key: "tempC", label: "Water temperature, °C (water source, 0-100)", kind: "text" },
    { key: "store", label: "Storage temperature (°C)", kind: "text" },
    { key: "gamma", label: "Temperature coefficient, %/°C (datasheet)", kind: "text" },
    { key: "rho", label: "Density, kg/m³ (typed source only)", kind: "text" },
    { key: "f", label: "Bioavailability F, 0-1", kind: "text" },
    { key: "t1", label: "Initial temperature T₁", kind: "text" },
    { key: "tunit", label: "Temperature unit", kind: "select", options: [{ value: "C", label: "°C" }, { value: "K", label: "K" }, { value: "F", label: "°F" }] },
  ];
  const read = (vals: Record<string, string>) => (k: string): string => vals[k] ?? "";
  test("units from the label or the tool's temperature select", () => {
    expect(fieldUnitOf(fields, "tempC", read({}))).toBe("°C");
    expect(fieldUnitOf(fields, "store", read({}))).toBe("°C");
    expect(fieldUnitOf(fields, "gamma", read({}))).toBeUndefined();
    expect(fieldUnitOf(fields, "rho", read({}))).toBe("kg/m³");
    expect(fieldUnitOf(fields, "f", read({}))).toBeUndefined();
    expect(fieldUnitOf(fields, "t1", read({ tunit: "F" }))).toBe("°F");
    expect(fieldUnitOf(fields, "t1", read({ tunit: "K" }))).toBe("K");
    expect(fieldUnitOf(fields, "tunit", read({}))).toBeUndefined();
  });
  test("% refused on a bare °C value; K and °F differences convert", () => {
    expect("error" in parseUncertainty("10 %", "24", "°C")).toBe(true);
    expect(parseUncertainty("1 K", "24", "°C")).toEqual({ u: 1, relative: false });
    const f = parseUncertainty("1.8 °F", "24", "°C");
    if ("error" in f) throw new Error(f.error);
    expect(f.u).toBeCloseTo(1, 12);
    // A K field keeps percentages (an absolute scale).
    expect(parseUncertainty("1 %", "300", "K")).toEqual({ u: 1, relative: true });
    // Unchanged behaviour without a field unit.
    expect(parseUncertainty("2 %", "998")).toEqual({ u: 2, relative: true });
  });
  test("pane passes the field unit", () => {
    expect(PANE).toMatch(/parseUncertainty\(t, read\(key\), fieldUnitOf\(calc\.fields, key, read\)\)/);
  });
});

describe("Lower: resonator, great circle, pipe, beam, shelf life", () => {
  test("plane-parallel cavity (g1g2 = 1) is marginal with no mode", () => {
    const r = resonator(0.5, Infinity, Infinity, 1e-6);
    if (!r) throw new Error("null");
    expect(r.marginal).toBe(true);
    expect(r.waistM).toBeNull();
    expect(toolSource("optics-resonator")).toMatch(/MARGINALLY STABLE/);
  });
  test("coincident points: distance 0, bearings not defined", () => {
    const r = greatCircle(51.4775, -0.4614, 51.4775, -0.4614);
    if (!r.ok) throw new Error(r.error);
    expect(r.distanceM).toBe(0);
    expect(r.bearingsUndefinedReason).toBe("same point");
    expect(Number.isNaN(r.finalBearingDeg)).toBe(true);
    const a = greatCircle(10, 20, -10, -160);
    if (!a.ok) throw new Error(a.error);
    expect(a.bearingsUndefinedReason).toBe("antipodal points");
    expect(toolSource("nav-greatcircle")).toMatch(/not defined \(\$\{res\.bearingsUndefinedReason\}\)/);
  });
  test("pipe refuses velocity and flow together; beam refuses moment overflow; zero-order k states %", () => {
    expect(toolSource("pipe")).toMatch(/if \(vRaw && qRaw\)/);
    expect(toolSource("beam")).toMatch(/overflow double precision/);
    expect(toolSource("shelf-life")).toMatch(/order === "zero" \? "% " : ""/);
  });
});

describe("11. The display pass (subscriptText.ts) and per-tool noise snapping", () => {
  test.each([
    // e-notation
    ["Second moment I = 3.3e+7 mm^4", "Second moment I = 3.3×10⁷ mm⁴"],
    ["Heat added TO the gas = -2.910e-11 J", "Heat added TO the gas = −2.910×10⁻¹¹ J"],
    ["orbit rate 8.8903e-4 rad/s", "orbit rate 8.8903×10⁻⁴ rad/s"],
    ["s^4 + 4.7863e+6s^2", "s⁴ + 4.7863×10⁶s²"],
    ["value 1.5e+0 exactly", "value 1.5 exactly"],
    // carets
    ["Area A = 10000 mm^2, k = 50 m^-1, a s^(-2) term", "Area A = 10000 mm², k = 50 m⁻¹, a s⁻² term"],
    ["t ∝ n^k and 1/e^2 radius", "t ∝ nᵏ and 1/e² radius"],
    ["a decimal N^-0.0851 is left", "a decimal N^−0.0851 is left"],
    // minus
    ["Max shear: -42.5 kN at x = 8 m", "Max shear: −42.5 kN at x = 8 m"],
    ["pole 0.6624 - 0.5623j", "pole 0.6624 − 0.5623j"],
    ["(-3, 4) and ≈ -7", "(−3, 4) and ≈ −7"],
    // left alone
    ["Shigley Eq. 6-27, valid 0-100 °C, 2019-2020, R-134a, x-3", "Shigley Eq. 6-27, valid 0-100 °C, 2019-2020, R-134a, x-3"],
    ['add "k=5e4" or "settle=-0.01" to a support', 'add "k=5e4" or "settle=-0.01" to a support'],
    ["IDs like TEM00 and 0x1e5 stay", "IDs like TEM00 and 0x1e5 stay"],
  ])("%s", (a, b) => expect(tidyDisplay(a)).toBe(b));

  test("figure text nodes, not markup", () => {
    const svg = '<svg viewBox="0 -10 100 100"><text x="-5" y="3">burn 1: -1467 m/s</text><text><tspan>climb -8 m/s</tspan></text></svg>';
    expect(tidySvgText(svg)).toBe('<svg viewBox="0 -10 100 100"><text x="-5" y="3">burn 1: −1467 m/s</text><text><tspan>climb −8 m/s</tspan></text></svg>');
  });

  test("ok results get the pass (lines, fallbacks, tables, captions, figures); refusals keep their wording", () => {
    const ok = tidyResultSubscripts({
      text: "Max shear: -42.5 kN",
      blocks: [
        { kind: "line", text: "Max shear: -42.5 kN" },
        { kind: "math", math: "x = 1e-3", fallback: "x = 1e-3" },
        { kind: "table", rows: [["I", "3.3e+7 mm^4"]] },
        { kind: "plot", svg: "<svg><text>-3 dB</text></svg>", caption: "decay to -60 dB", alt: "", w: 1, h: 1 },
      ],
    });
    expect(ok.text).toBe("Max shear: −42.5 kN");
    expect(ok.blocks).toEqual([
      { kind: "line", text: "Max shear: −42.5 kN" },
      { kind: "math", math: "x = 1e-3", fallback: "x = 1×10⁻³" },
      { kind: "table", rows: [["I", "3.3×10⁷ mm⁴"]] },
      { kind: "plot", svg: "<svg><text>−3 dB</text></svg>", caption: "decay to −60 dB", alt: "", w: 1, h: 1 },
    ]);
    const bad = tidyResultSubscripts({ text: 'Write "1e6" or 1e6 here', ok: false });
    expect(bad.text).toBe('Write "1e6" or 1e6 here');
  });

  test("snapping is against the tool's own scale (the reviewer's cases)", () => {
    expect(snapGroup([50, 3.5e-15, -50])).toEqual([50, 0, -50]); // pure-shear σ2
    expect(snapGroup([-1.127e-10, 100])).toEqual([0, 100]); // plate reactions
    expect(snapGroup([1.2e5, -2.9e-11])).toEqual([1.2e5, 0]); // isentropic W, Q
    expect(snapNoise(9.4e-16, 180)).toBe(0); // DH yaw, degrees
    expect(snapNoise(-1.22e-15, 50 * 1.5)).toBe(0); // Jacobian τ2 against |F|·reach
    expect(snapNoise(-6.994e-17, 1, 1e-12)).toBe(0); // marginal pole real part
    expect(snapNoise(1.119e-12, 2000, 1e-12)).toBe(0); // Chebyshev HP pole imaginary part
    // An all-small result is never zeroed, and a genuine small value beside a large one survives at 1e-10.
    expect(snapGroup([1e-14, 2e-14])).toEqual([1e-14, 2e-14]);
    expect(snapGroup([1e-6, 100])).toEqual([1e-6, 100]);
  });

  test("the snapping sites and source fixes are in place", () => {
    expect(toolSource("stress")).toMatch(/const pr = snapGroup\(/);
    expect(toolSource("thermo-process")).toMatch(/snapGroup\(\[res\.work, res\.heat/);
    expect(toolSource("plate-fea")).toMatch(/snapGroup\(res\.reaction\)/);
    expect(toolSource("robotics-jacobian")).toMatch(/snapNoise\(res\.jointTorques\[1\], torqueScale\)/);
    expect(toolSource("robotics-dh")).toMatch(/snapNoise\(\(v \* 180\) \/ Math\.PI, 180\)/);
    expect(PANE).toMatch(/function fmtComplexPlain\(c: \{ re: number; im: number \}, scale = /);
    expect(PANE).toMatch(/for \(const c of ENG_CALCS\) \{\n\s+const raw = c\.compute;\n\s+c\.compute = \(read\) => tidyResultSubscripts\(raw\(read\)\);/);
    // The shared unit note no longer shows input syntax with an exponent and a caret.
    expect(PANE).not.toMatch(/"\(200 GPa, 1e6 mm\^4/);
    expect(toolSource("fatigue-life")).not.toMatch(/N\^\$\{engNum/);
  });

  /**
   * SOURCE SCAN for the legacy prose the pass cannot fix: a DECIMAL exponent after a caret in a result string
   * ("N^${…}" with a fractional value, "e^0.63", "2^(18/6)") has no superscript form. Pinned to the files fixed in
   * this round; the pass handles integer exponents and e-notation everywhere else.
   */
  test("no caret before an interpolated or decimal exponent in the fixed sources", () => {
    const files = ["../vibration.ts", "../computation.ts", "../photometry.ts"].map((f) => fs.readFileSync(path.join(__dirname, f), "utf8"));
    for (const src of files) expect(src).not.toMatch(/[`"'][^`"'\n]*\w\^(?:\$\{|\(\$\{|\d+\.\d)[^`"'\n]*[`"']/);
  });
});

describe("11. Display gate over every library registry tool's defaults", () => {
  const regs = [...PANE.matchAll(/import \{ ([A-Z_]+_CALCS) \} from "\.\.\/lib\/([A-Za-z0-9]+)"/g)].map((m) => [m[1], m[2]]);
  type Tool = { id: string; fields: Array<{ key: string; default: string }>; compute: (r: (k: string) => string) => AnalyzeOutput };
  const tools: Tool[] = [];
  for (const [name, file] of regs) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("../" + file);
    for (const c of (mod[name] ?? []) as Array<Partial<Tool>>) if (c.fields && typeof c.compute === "function") tools.push(c as Tool);
  }
  test("the scan is not vacuous", () => expect(tools.length).toBeGreaterThan(80));
  test.each(tools.map((c) => [c.id, c] as const))("%s: no e-notation, integer caret or hyphen-minus sign left", (id, c) => {
    const d: Record<string, string> = {};
    for (const f of c.fields) d[f.key] = f.default;
    const out = tidyResultSubscripts(c.compute((k) => d[k] ?? ""));
    if (out.ok === false) return;
    const texts: string[] = [];
    for (const b of out.blocks ?? []) {
      if (b.kind === "line") texts.push(b.text);
      if (b.kind === "math") texts.push(b.fallback);
      if (b.kind === "table") texts.push(b.label ?? "", ...b.rows.flat());
      if (b.kind === "plot") texts.push(b.caption, b.alt);
    }
    const unquoted = texts.map((t) => t.replace(/"[^"\n]*"|“[^”\n]*”/g, ""));
    const left = unquoted.filter(
      (t) => /(^|[^\w.])-?\d+(?:\.\d+)?[eE][+-]?\d+(?!\d|\.\d)/.test(t) || /[A-Za-z0-9)]\^[-+]?\d+(?!\d|\.\d)/.test(t) || /(^|[\s(=:])-\d/.test(t),
    );
    expect({ id, left }).toEqual({ id, left: [] });
  });
});
