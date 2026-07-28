// Oracle tests for the beam engine.
//
// Every case here is a closed form from a mechanics-of-materials text, checked
// against the ENGINE'S OWN output — the point being that the closed form is
// derived independently of the Macaulay machinery under test. Where the answer
// is rational the assertion is EXACT (comparing the returned `Rat`), because an
// exact engine that quietly returns 0.3749999 has lost the thing that makes it
// worth having.

import { analyzeBeam, BeamInput, BeamResult, Load, totalLoad } from "../beam";
import { Rat, ratInt, ratDiv, ratToNumber } from "../cas";

const R = (n: number, d = 1): Rat => ratDiv(ratInt(n), ratInt(d));

function ok(input: BeamInput): BeamResult {
  const r = analyzeBeam(input);
  if (!r.ok) throw new Error(`expected a solution, got: ${r.error}`);
  return r;
}

/** Exact rational equality, printed readably when it fails. */
function expectExact(actual: Rat, expected: Rat, what: string): void {
  const a = `${actual.n}/${actual.d}`;
  const e = `${expected.n}/${expected.d}`;
  expect(`${what} = ${a}`).toBe(`${what} = ${e}`);
}

const near = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

describe("simply supported beam", () => {
  // R1 = R2 = P/2 · Mmax = PL/4 at midspan · vmax = -PL^3/(48EI)
  test("central point load matches the closed form exactly", () => {
    const L = 8,
      P = 1000;
    const r = ok({
      length: R(L),
      supports: [
        { kind: "pin", x: R(0) },
        { kind: "roller", x: R(L) },
      ],
      loads: [{ kind: "point", x: R(L, 2), p: R(P) }],
    });
    expectExact(r.reactions[0].forceExact, R(P, 2), "R1");
    expectExact(r.reactions[1].forceExact, R(P, 2), "R2");
    near(r.maxMoment.value, (P * L) / 4);
    near(r.maxMoment.x, L / 2);
    near(r.maxEiDeflection.value, -(P * L ** 3) / 48);
    expect(r.determinacy.degree).toBe(0);
  });

  // Mmax = wL^2/8 · vmax = -5wL^4/(384EI)
  test("uniform load matches the closed form", () => {
    const L = 6,
      w = 12;
    const r = ok({
      length: R(L),
      supports: [
        { kind: "pin", x: R(0) },
        { kind: "roller", x: R(L) },
      ],
      loads: [{ kind: "udl", a: R(0), b: R(L), w: R(w) }],
    });
    expectExact(r.reactions[0].forceExact, R((w * L) / 2), "R1");
    near(r.maxMoment.value, (w * L ** 2) / 8);
    near(r.maxMoment.x, L / 2);
    near(r.maxEiDeflection.value, (-5 * w * L ** 4) / 384);
  });

  // Off-centre load: R1 = Pb/L, R2 = Pa/L — the classic lever rule.
  test("off-centre point load splits by the lever rule, exactly", () => {
    const L = 10,
      a = 3,
      P = 700;
    const r = ok({
      length: R(L),
      supports: [
        { kind: "pin", x: R(0) },
        { kind: "roller", x: R(L) },
      ],
      loads: [{ kind: "point", x: R(a), p: R(P) }],
    });
    expectExact(r.reactions[0].forceExact, R(P * (L - a), L), "R1");
    expectExact(r.reactions[1].forceExact, R(P * a, L), "R2");
    near(r.maxMoment.value, (P * a * (L - a)) / L);
    near(r.maxMoment.x, a);
  });

  test("couple at midspan is resisted by an equal and opposite reaction couple", () => {
    const L = 4,
      M0 = 200;
    const r = ok({
      length: R(L),
      supports: [
        { kind: "pin", x: R(0) },
        { kind: "roller", x: R(L) },
      ],
      loads: [{ kind: "moment", x: R(L, 2), m: R(M0) }],
    });
    expectExact(r.reactions[0].forceExact, R(M0, L), "R1");
    expectExact(r.reactions[1].forceExact, R(-M0, L), "R2");
    // Global moment about the left end must vanish: R2·L + M0 = 0.
    near(r.reactions[1].force * L + M0, 0);
  });
});

describe("cantilever", () => {
  // R = P · fixed-end moment magnitude PL · v_end = -PL^3/(3EI)
  test("end point load", () => {
    const L = 3,
      P = 500;
    const r = ok({
      length: R(L),
      supports: [{ kind: "fixed", x: R(0) }],
      loads: [{ kind: "point", x: R(L), p: R(P) }],
    });
    expectExact(r.reactions[0].forceExact, R(P), "R");
    expect(Math.abs(ratToNumber(r.reactions[0].momentExact as Rat))).toBeCloseTo(P * L, 9);
    near(Math.abs(r.minMoment.value || r.maxMoment.value), P * L);
    near(r.maxEiDeflection.value, -(P * L ** 3) / 3);
  });

  // v_end = -wL^4/(8EI), fixed-end moment wL^2/2
  test("uniform load", () => {
    const L = 5,
      w = 20;
    const r = ok({
      length: R(L),
      supports: [{ kind: "fixed", x: R(0) }],
      loads: [{ kind: "udl", a: R(0), b: R(L), w: R(w) }],
    });
    expectExact(r.reactions[0].forceExact, R(w * L), "R");
    expect(Math.abs(ratToNumber(r.reactions[0].momentExact as Rat))).toBeCloseTo((w * L ** 2) / 2, 9);
    near(r.maxEiDeflection.value, -(w * L ** 4) / 8);
  });
});

describe("the fixed-end moment reads the same way at either end", () => {
  // REGRESSION. The reported moment used to be the raw Macaulay unknown, whose
  // term activates only to the right of its support. At a left-hand wall that
  // coincides with the internal bending moment; at a right-hand wall it does
  // not, and a right-fixed cantilever reported +wL^2/2 where every textbook
  // says the wall is in HOGGING. Both must now be negative, and the mirrored
  // beam must be the mirror image.
  const L = 4,
    w = 6;
  const expected = -(w * L ** 2) / 2;

  test("fixed at the left end", () => {
    const r = ok({
      length: R(L),
      supports: [{ kind: "fixed", x: R(0) }],
      loads: [{ kind: "udl", a: R(0), b: R(L), w: R(w) }],
    });
    near(r.reactions[0].moment as number, expected);
  });

  test("fixed at the right end — the case that was wrong", () => {
    const r = ok({
      length: R(L),
      supports: [{ kind: "fixed", x: R(L) }],
      loads: [{ kind: "udl", a: R(0), b: R(L), w: R(w) }],
    });
    near(r.reactions[0].moment as number, expected);
    // The free-body couple is a different quantity and is reported separately.
    near(r.reactions[0].couple as number, expected);
  });

  test("both walls of a fixed-fixed beam hog", () => {
    const r = ok({
      length: R(6),
      supports: [
        { kind: "fixed", x: R(0) },
        { kind: "fixed", x: R(6) },
      ],
      loads: [{ kind: "udl", a: R(0), b: R(6), w: R(10) }],
    });
    // Textbook: wL^2/12 hogging at each end, wL^2/24 sagging at midspan.
    near(r.reactions[0].moment as number, -(10 * 36) / 12);
    near(r.reactions[1].moment as number, -(10 * 36) / 12);
    near(r.momentAt(3), (10 * 36) / 24);
  });
});

describe("statically indeterminate beams — the same code path", () => {
  // Propped cantilever, UDL: R_roller = 3wL/8, R_fixed = 5wL/8, M_fixed = wL^2/8.
  // This is the case the force method is normally wheeled out for.
  test("propped cantilever under uniform load", () => {
    const L = 8,
      w = 24;
    const r = ok({
      length: R(L),
      supports: [
        { kind: "fixed", x: R(0) },
        { kind: "roller", x: R(L) },
      ],
      loads: [{ kind: "udl", a: R(0), b: R(L), w: R(w) }],
    });
    expect(r.determinacy.degree).toBe(1);
    expectExact(r.reactions[0].forceExact, R(5 * w * L, 8), "R_fixed");
    expectExact(r.reactions[1].forceExact, R(3 * w * L, 8), "R_roller");
    expect(Math.abs(ratToNumber(r.reactions[0].momentExact as Rat))).toBeCloseTo((w * L ** 2) / 8, 9);
  });

  // Fixed-fixed, central point load: R = P/2, |M| = PL/8 at ends AND midspan,
  // v_mid = -PL^3/(192EI).
  test("fixed-fixed beam with a central point load", () => {
    const L = 6,
      P = 900;
    const r = ok({
      length: R(L),
      supports: [
        { kind: "fixed", x: R(0) },
        { kind: "fixed", x: R(L) },
      ],
      loads: [{ kind: "point", x: R(L, 2), p: R(P) }],
    });
    expect(r.determinacy.degree).toBe(2);
    expectExact(r.reactions[0].forceExact, R(P, 2), "R1");
    expectExact(r.reactions[1].forceExact, R(P, 2), "R2");
    expect(Math.abs(ratToNumber(r.reactions[0].momentExact as Rat))).toBeCloseTo((P * L) / 8, 9);
    near(r.maxMoment.value, (P * L) / 8);
    near(Math.abs(r.minMoment.value), (P * L) / 8);
    near(r.maxEiDeflection.value, -(P * L ** 3) / 192);
  });
});

describe("triangular and trapezoidal loads", () => {
  // Simply supported with a triangular load 0 -> w over the whole span:
  // R1 = wL/6, R2 = wL/3, Mmax = wL^2/(9*sqrt(3)) at x = L/sqrt(3).
  test("triangular load gives the sixth/third split exactly", () => {
    const L = 9,
      w = 30;
    const r = ok({
      length: R(L),
      supports: [
        { kind: "pin", x: R(0) },
        { kind: "roller", x: R(L) },
      ],
      loads: [{ kind: "ramp", a: R(0), b: R(L), w1: R(0), w2: R(w) }],
    });
    expectExact(r.reactions[0].forceExact, R(w * L, 6), "R1");
    expectExact(r.reactions[1].forceExact, R(w * L, 3), "R2");
    near(r.maxMoment.value, (w * L ** 2) / (9 * Math.sqrt(3)), 1e-4);
    near(r.maxMoment.x, L / Math.sqrt(3), 1e-2);
  });

  test("a trapezoid with equal ends is the uniform load", () => {
    const L = 7,
      w = 15;
    const base = {
      length: R(L),
      supports: [
        { kind: "pin" as const, x: R(0) },
        { kind: "roller" as const, x: R(L) },
      ],
    };
    const ramp = ok({ ...base, loads: [{ kind: "ramp", a: R(0), b: R(L), w1: R(w), w2: R(w) }] });
    const udl = ok({ ...base, loads: [{ kind: "udl", a: R(0), b: R(L), w: R(w) }] });
    expectExact(ramp.reactions[0].forceExact, udl.reactions[0].forceExact, "R1");
    near(ramp.maxMoment.value, udl.maxMoment.value);
    near(ramp.maxEiDeflection.value, udl.maxEiDeflection.value);
  });

  test("a partial distributed load carries the right total", () => {
    const loads: Load[] = [{ kind: "udl", a: R(2), b: R(6), w: R(10) }];
    expect(totalLoad(loads)).toBeCloseTo(40, 12);
    const r = ok({
      length: R(8),
      supports: [
        { kind: "pin", x: R(0) },
        { kind: "roller", x: R(8) },
      ],
      loads,
    });
    near(r.reactions[0].force + r.reactions[1].force, 40);
  });
});

describe("refusals", () => {
  test("a single roller is a mechanism and is named as one", () => {
    const r = analyzeBeam({
      length: R(4),
      supports: [{ kind: "roller", x: R(0) }],
      loads: [{ kind: "point", x: R(2), p: R(10) }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mechanism/i);
  });

  test("duplicated supports are refused rather than treated as stiffer", () => {
    const r = analyzeBeam({
      length: R(4),
      supports: [
        { kind: "pin", x: R(1) },
        { kind: "roller", x: R(1) },
      ],
      loads: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/same position/i);
  });

  test("a load off the end of the beam is refused", () => {
    const r = analyzeBeam({
      length: R(4),
      supports: [
        { kind: "pin", x: R(0) },
        { kind: "roller", x: R(4) },
      ],
      loads: [{ kind: "point", x: R(9), p: R(10) }],
    });
    expect(r.ok).toBe(false);
  });

  test("zero length is refused", () => {
    const r = analyzeBeam({ length: R(0), supports: [{ kind: "fixed", x: R(0) }], loads: [] });
    expect(r.ok).toBe(false);
  });
});
