// Oracle tests for the circuit engine — textbook networks whose answers are
// known in closed form, checked EXACTLY wherever the answer is rational.
//
// The AC cases are the interesting oracles because they do not depend on the
// solver at all: an RC low-pass at its corner frequency is 1/sqrt(2) of the
// input at exactly -45 degrees, and a series RLC at resonance is purely
// resistive. Both fall out of the physics, and both would break if the
// impedance signs, the MNA stamps or the frequency conversion were wrong.

import { parseNetlist, parseValue, solveDc, solveAc, frequencySweep, dB, Element } from "../circuit";
import { Rat, ratInt, ratDiv, ratSub, ratIsZero } from "../cas";

function net(text: string): Element[] {
  const p = parseNetlist(text);
  if (p.errors.length) throw new Error(`netlist errors: ${p.errors.join(" | ")}`);
  return p.elements;
}
function dc(text: string) {
  const r = solveDc(net(text));
  if (!r.ok) throw new Error(`expected a solution, got: ${r.error}`);
  return r;
}
const volts = (r: ReturnType<typeof dc>, name: string): number =>
  r.nodes.find((n) => n.name === name)?.volts ?? NaN;
const exactVolts = (r: ReturnType<typeof dc>, name: string): Rat =>
  r.nodes.find((n) => n.name === name)?.exact as Rat;

const R = (n: number, d = 1): Rat => ratDiv(ratInt(n), ratInt(d));
function expectExact(actual: Rat, expected: Rat, what: string): void {
  expect(`${what} = ${actual.n}/${actual.d}`).toBe(`${what} = ${expected.n}/${expected.d}`);
}

describe("value parsing", () => {
  test("SI suffixes, with meg beating m", () => {
    expect(parseValue("1k")?.value).toBe(1000);
    expect(parseValue("4.7u")?.value).toBeCloseTo(4.7e-6, 18);
    expect(parseValue("10meg")?.value).toBe(1e7);
    expect(parseValue("10m")?.value).toBeCloseTo(0.01, 15);
    expect(parseValue("bananas")).toBeNull();
  });

  test("4.7k is exactly 4700, not 4699.999999", () => {
    const v = parseValue("4.7k");
    expectExact(v?.exact as Rat, R(4700), "4.7k");
  });

  // RKM notation is what is actually printed on a schematic. The first draft of
  // the parser rejected it, which the power-balance test found by using a real
  // resistor value.
  test("RKM notation, where the multiplier replaces the decimal point", () => {
    expectExact(parseValue("2k2")?.exact as Rat, R(2200), "2k2");
    expectExact(parseValue("4r7")?.exact as Rat, R(47, 10), "4r7");
    expectExact(parseValue("1m5")?.exact as Rat, R(15, 10000), "1m5");
    expect(parseValue("10meg")?.value).toBe(1e7);
    expect(parseValue("1k5")?.value).toBe(1500);
    // Still rejects nonsense rather than guessing at it.
    expect(parseValue("2k2k")).toBeNull();
    expect(parseValue("k2")).toBeNull();
  });
});

describe("DC networks, exactly", () => {
  test("voltage divider reports 10/3 V and not 3.3333333333", () => {
    const r = dc("V1 1 0 5\nR1 1 2 1k\nR2 2 0 2k");
    expectExact(exactVolts(r, "2"), R(10, 3), "V(2)");
    expect(volts(r, "1")).toBeCloseTo(5, 12);
    expect(r.exact).toBe(true);
  });

  test("series resistors divide in proportion", () => {
    const r = dc("V1 1 0 12\nR1 1 2 100\nR2 2 3 200\nR3 3 0 300");
    expectExact(exactVolts(r, "2"), R(10), "V(2)");
    expectExact(exactVolts(r, "3"), R(6), "V(3)");
  });

  test("parallel resistors halve the equivalent, and the source current shows it", () => {
    const r = dc("V1 1 0 10\nR1 1 0 100\nR2 1 0 100");
    const i = r.currents.find((c) => c.name === "V1") as { amps: number };
    // 10 V across 50 ohm draws 0.2 A out of the source.
    expect(Math.abs(i.amps)).toBeCloseTo(0.2, 12);
  });

  test("a current source into a resistor gives Ohm's law", () => {
    const r = dc("I1 0 1 2m\nR1 1 0 1k");
    // 2 mA into 1 k is 2 V.
    expectExact(exactVolts(r, "1"), R(2), "V(1)");
  });

  test("a balanced Wheatstone bridge has zero across the bridge", () => {
    const r = dc("V1 1 0 9\nR1 1 2 1k\nR2 2 0 2k\nR3 1 3 2k\nR4 3 0 4k\nR5 2 3 500");
    expect(ratIsZero(ratSub(exactVolts(r, "2"), exactVolts(r, "3")))).toBe(true);
    const bridge = r.currents.find((c) => c.name === "R5") as { amps: number };
    expect(bridge.amps).toBeCloseTo(0, 15);
  });

  test("power delivered equals power dissipated", () => {
    const r = dc("V1 1 0 24\nR1 1 2 470\nR2 2 0 1k\nR3 2 0 2k2");
    expect(r.totalDelivered).toBeCloseTo(r.totalDissipated, 10);
    expect(r.totalDelivered).toBeGreaterThan(0);
  });
});

describe("AC steady state — oracles that do not use the solver", () => {
  // An RC low-pass at f = 1/(2*pi*R*C) is exactly 1/sqrt(2) of the input,
  // at exactly -45 degrees. Nothing about that comes from this implementation.
  test("RC low-pass at its corner frequency is -3 dB and -45 degrees", () => {
    const Rv = 1000;
    const Cv = 1e-6;
    const fc = 1 / (2 * Math.PI * Rv * Cv);
    const r = solveAc(net(`V1 1 0 1\nR1 1 2 1k\nC1 2 0 1u`), fc);
    if (!r.ok) throw new Error(r.error);
    const out = r.nodes.find((n) => n.name === "2") as { magnitude: number; phaseDeg: number };
    expect(out.magnitude).toBeCloseTo(1 / Math.SQRT2, 9);
    expect(out.phaseDeg).toBeCloseTo(-45, 7);
    expect(dB(out.magnitude)).toBeCloseTo(-3.0103, 3);
  });

  test("the low-pass rolls off at 20 dB per decade above the corner", () => {
    const elements = net(`V1 1 0 1\nR1 1 2 1k\nC1 2 0 1u`);
    const a = solveAc(elements, 10000);
    const b = solveAc(elements, 100000);
    if (!a.ok || !b.ok) throw new Error("solve failed");
    const ma = (a.nodes.find((n) => n.name === "2") as { magnitude: number }).magnitude;
    const mb = (b.nodes.find((n) => n.name === "2") as { magnitude: number }).magnitude;
    expect(dB(ma) - dB(mb)).toBeCloseTo(20, 1);
  });

  test("an RC high-pass is the mirror image", () => {
    const fc = 1 / (2 * Math.PI * 1000 * 1e-6);
    const r = solveAc(net(`V1 1 0 1\nC1 1 2 1u\nR1 2 0 1k`), fc);
    if (!r.ok) throw new Error(r.error);
    const out = r.nodes.find((n) => n.name === "2") as { magnitude: number; phaseDeg: number };
    expect(out.magnitude).toBeCloseTo(1 / Math.SQRT2, 9);
    expect(out.phaseDeg).toBeCloseTo(+45, 7);
  });

  // At resonance the reactances cancel exactly and the network is purely
  // resistive, so the whole source voltage appears across R and the phase is 0.
  test("a series RLC at resonance is purely resistive", () => {
    const L = 10e-3;
    const C = 1e-6;
    const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
    const r = solveAc(net(`V1 1 0 1\nL1 1 2 10m\nC1 2 3 1u\nR1 3 0 100`), f0);
    if (!r.ok) throw new Error(r.error);
    const out = r.nodes.find((n) => n.name === "3") as { magnitude: number; phaseDeg: number };
    expect(out.magnitude).toBeCloseTo(1, 6);
    expect(Math.abs(out.phaseDeg)).toBeLessThan(1e-4);
  });

  test("a purely resistive divider is frequency independent", () => {
    const elements = net(`V1 1 0 6\nR1 1 2 1k\nR2 2 0 1k`);
    for (const f of [1, 1000, 1e6]) {
      const r = solveAc(elements, f);
      if (!r.ok) throw new Error(r.error);
      const out = r.nodes.find((n) => n.name === "2") as { magnitude: number; phaseDeg: number };
      expect(out.magnitude).toBeCloseTo(3, 10);
      expect(Math.abs(out.phaseDeg)).toBeLessThan(1e-9);
    }
  });
});

describe("frequency sweep", () => {
  test("the sweep is geometric and brackets the corner correctly", () => {
    const s = frequencySweep(net(`V1 1 0 1\nR1 1 2 1k\nC1 2 0 1u`), "2", 1, 1e5, 60);
    if ("ok" in s && s.ok === false) throw new Error(s.error);
    const pts = (s as { points: { f: number; magnitude: number }[] }).points;
    expect(pts.length).toBe(60);
    // Geometric spacing: the ratio between consecutive points is constant.
    const r1 = pts[1].f / pts[0].f;
    const r2 = pts[30].f / pts[29].f;
    expect(r1).toBeCloseTo(r2, 9);
    // Monotonically falling for a low-pass.
    for (let i = 1; i < pts.length; i++) expect(pts[i].magnitude).toBeLessThan(pts[i - 1].magnitude + 1e-12);
    expect(pts[0].magnitude).toBeCloseTo(1, 3);
  });

  test("a sweep on a node that does not exist says which nodes do", () => {
    const s = frequencySweep(net(`V1 1 0 1\nR1 1 2 1k\nC1 2 0 1u`), "99", 1, 1000);
    expect("ok" in s && s.ok === false).toBe(true);
    if ("ok" in s && s.ok === false) expect(s.error).toMatch(/no node called "99"/);
  });
});

describe("refusals name the circuit error, not the matrix", () => {
  test("a floating node is named", () => {
    const r = solveDc(net("V1 1 0 5\nR1 1 2 1k\nR2 3 4 1k"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no DC path to ground/i);
  });

  test("two voltage sources across the same nodes is a contradiction", () => {
    const r = solveDc(net("V1 1 0 5\nV2 1 0 3\nR1 1 0 1k"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cannot both set|parallel with another voltage source/i);
  });

  test("a circuit with no source is refused rather than answered with zeros", () => {
    const r = solveDc(net("R1 1 0 1k\nR2 1 2 1k\nR3 2 0 1k"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no source/i);
  });

  test("an inductor at DC is named as the short it is", () => {
    const r = solveDc(net("V1 1 0 5\nL1 1 2 10m\nR1 2 0 1k"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/short circuit at DC/i);
  });

  test("a zero-ohm resistor and a self-looped element are rejected at parse time", () => {
    expect(parseNetlist("R1 1 0 0").errors.join(" ")).toMatch(/short/i);
    expect(parseNetlist("R1 1 1 100").errors.join(" ")).toMatch(/both ends/i);
  });

  test("a duplicated element name is rejected", () => {
    expect(parseNetlist("R1 1 0 100\nR1 1 2 200").errors.join(" ")).toMatch(/both called/i);
  });

  test("a malformed line says what it needed", () => {
    expect(parseNetlist("R1 1 0").errors.join(" ")).toMatch(/four fields/i);
    expect(parseNetlist("Q1 1 0 5").errors.join(" ")).toMatch(/must start with/i);
  });
});

describe("capacitors at DC", () => {
  test("a capacitor is an open circuit and the result says so", () => {
    const r = dc("V1 1 0 5\nR1 1 2 1k\nR2 2 0 1k\nC1 2 0 10u");
    expectExact(exactVolts(r, "2"), R(5, 2), "V(2)");
    expect(r.notes.join(" ")).toMatch(/open circuits at DC/i);
  });
});
