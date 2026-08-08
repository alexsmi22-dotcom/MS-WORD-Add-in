// Units-aware solving: formula + knowns with units → value with a DERIVED
// unit, dimension mismatches refused by symbol and unit.

import { solveWithUnits, dimsToUnit } from "../unitSolve";

function stepText(r: NonNullable<ReturnType<typeof solveWithUnits>>): string {
  return r.steps.map((s) => s.text ?? s.math).join("\n");
}

describe("the flagship: F = m a", () => {
  test("3 kg × 2 m/s² = 6 N, unit DERIVED not assumed", () => {
    const r = solveWithUnits("F = m a\nm = 3 kg\na = 2 m/s^2")!;
    expect(r.refusal).toBeUndefined();
    expect(r.unknown).toBe("F");
    expect(r.value).toBe(6);
    expect(r.namedUnit).toBe("N");
    expect(r.unit).toBe("kg·m/s²");
  });

  test("solving for a different symbol rearranges symbolically first", () => {
    const r = solveWithUnits("F = m a\nF = 6 N\nm = 3 kg")!;
    expect(r.unknown).toBe("a");
    expect(r.value).toBe(2);
    expect(r.unit).toBe("m/s²");
    expect(stepText(r)).toContain("a = F/m");
  });
});

describe("conversions are exact and reported", () => {
  test("km and hours convert to SI, and the step says so", () => {
    const r = solveWithUnits("v = d/t\nd = 3 km\nt = 0.5 h")!;
    expect(r.value).toBeCloseTo(3000 / 1800, 9);
    expect(r.unit).toBe("m/s");
    expect(stepText(r)).toContain("Converted to SI first");
    expect(stepText(r)).toContain("3 km");
  });

  test("energy comes out named: J", () => {
    const r = solveWithUnits("K = (1/2) m v^2\nm = 4 kg\nv = 3 m/s")!;
    expect(r.value).toBe(18);
    expect(r.namedUnit).toBe("J");
  });

  test("pressure comes out named: Pa", () => {
    const r = solveWithUnits("P = F/A\nF = 10 N\nA = 2 m^2")!;
    expect(r.value).toBe(5);
    expect(r.namedUnit).toBe("Pa");
  });
});

describe("dimension mismatches are refused by name", () => {
  test("adding metres to metres-per-second names both symbols' units", () => {
    const r = solveWithUnits("v = u + a*t\nu = 3 m\na = 2 m/s^2\nt = 4 s")!;
    expect(r.refusal).toBeDefined();
    expect(r.refusal).toContain("cannot be added");
    expect(r.refusal).toContain("m/s");
  });

  test("sin of a dimensioned quantity is refused with guidance", () => {
    const r = solveWithUnits("y = sin(x)\nx = 2 m")!;
    expect(r.refusal).toBeDefined();
    expect(r.refusal).toContain("pure number");
  });

  test("a dimensioned exponent is refused", () => {
    const r = solveWithUnits("y = 2^t\nt = 3 s")!;
    expect(r.refusal).toBeDefined();
    expect(r.refusal).toContain("exponent");
  });
});

describe("what stays out of this path", () => {
  test("plain systems (no units anywhere) are untouched", () => {
    expect(solveWithUnits("x + y = 3\nx - y = 1")).toBeNull();
  });

  test("single-line equations are untouched", () => {
    expect(solveWithUnits("F = m a")).toBeNull();
  });

  test("an unreadable unit word bails out rather than guessing", () => {
    expect(solveWithUnits("F = m a\nm = 3 flibbers\na = 2 m/s^2")).toBeNull();
  });

  test("two unknowns → refusal naming them", () => {
    const r = solveWithUnits("F = m a\nm = 3 kg")!;
    expect(r.refusal).toContain("F");
    expect(r.refusal).toContain("a");
  });
});

describe("adversarial regressions", () => {
  test("kelvins are never dropped from a displayed unit (temp vs temperature key)", () => {
    const r = solveWithUnits("c = Q/(m*dT)\nQ = 100 J\nm = 2 kg\ndT = 5 K")!;
    expect(r.refusal).toBeUndefined();
    expect(r.value).toBe(10);
    expect(r.unit).toContain("K"); // m²/(s²·K) — the kelvin survives
    const y = solveWithUnits("y = x*1\nx = 300 K")!;
    expect(y.unit).toBe("K");
  });

  test("speed comes out positive, the minus branch disclosed with its value", () => {
    const r = solveWithUnits("K = (1/2) m v^2\nK = 18 J\nm = 4 kg")!;
    expect(r.value).toBe(3);
    expect(r.unit).toBe("m/s");
    expect(r.caveats.some((c) => c.includes("-3"))).toBe(true);
    // No false claim that branches "differ in sign".
    expect(r.caveats.every((c) => !c.includes("differs in sign"))).toBe(true);
  });

  test("fraction knowns work: m = 1/2 kg", () => {
    const r = solveWithUnits("F = m a\nm = 1/2 kg\na = 2 m/s^2")!;
    expect(r.refusal).toBeUndefined();
    expect(r.value).toBe(1);
    expect(r.namedUnit).toBe("N");
  });

  test("sin of an angle WORKS after the tool converted degrees itself", () => {
    const r = solveWithUnits("y = sin(x)\nx = 30 deg")!;
    expect(r.refusal).toBeUndefined();
    expect(r.value).toBeCloseTo(0.5, 9);
    expect(r.unit).toBe("");
  });

  test("a mismatch names the actual subtree, not '(…)-part'", () => {
    const r = solveWithUnits("v = u + a*t\nu = 3 m\na = 2 m/s^2\nt = 4 s")!;
    expect(r.refusal).toBeDefined();
    expect(r.refusal).not.toContain("-part");
  });

  test("bare 1/s is not force-named Hz (ambiguous with rad/s and Bq)", () => {
    const r = solveWithUnits("w = v/r\nv = 4 m/s\nr = 2 m")!;
    expect(r.namedUnit).toBeNull();
    expect(r.unit).toBe("1/s");
  });

  test("fractional dims render as parseable ASCII, not garbled superscripts", () => {
    expect(dimsToUnit({ length: 0.5 })).toBe("m^0.5");
  });

  test("no duplicated ≠-condition caveats", () => {
    const r = solveWithUnits("R = D/t\nD = 8 m\nt = 2 s")!;
    const set = new Set(r.caveats);
    expect(set.size).toBe(r.caveats.length);
  });
});

describe("honesty details", () => {
  test("sqrt halves dimensions: period of a pendulum comes out in seconds", () => {
    const r = solveWithUnits("T = 2 π sqrt(L/g)\nL = 2 m\ng = 9.8 m/s^2")!;
    expect(r.refusal).toBeUndefined();
    expect(r.unit).toBe("s");
    expect(r.value).toBeCloseTo(2 * Math.PI * Math.sqrt(2 / 9.8), 9);
  });

  test("unused knowns are disclosed", () => {
    const r = solveWithUnits("F = m a\nm = 3 kg\na = 2 m/s^2\nq = 7 s")!;
    expect(r.caveats.some((c) => c.includes("Unused") && c.includes("q"))).toBe(true);
  });

  test("dimensionless results carry no invented unit", () => {
    const r = solveWithUnits("r = a/b\na = 6 m\nb = 2 m")!;
    expect(r.value).toBe(3);
    expect(r.unit).toBe("");
    expect(r.namedUnit).toBeNull();
  });

  test("dimsToUnit formats positive-over-negative with real superscripts", () => {
    expect(dimsToUnit({ mass: 1, length: 1, time: -2 })).toBe("kg·m/s²");
    expect(dimsToUnit({ time: -1 })).toBe("1/s");
    expect(dimsToUnit({})).toBe("");
  });
});
