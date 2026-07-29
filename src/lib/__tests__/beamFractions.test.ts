// Fractions in every beam field, and — the part that matters — EXACT all the
// way through the solve rather than merely accepted at the door.
//
// The point of this engine is that a third stays a third. Until now `1/3` was
// rejected by the field patterns before the shared parser that handles it was
// ever reached, so the single notation that is exact was the single notation
// refused: a support at L/3 had to be typed as 2.6666666667, which puts a
// rounding error into the input of an exact solver. The truss parser has always
// accepted fractions, because it tokenises and hands each token straight to the
// CAS — so this also closes an inconsistency between two engines sharing a CAS.
//
// So these tests assert on the returned `Rat`, not on a decimal. Parsing `1/3`
// and then solving in floating point would pass a test that only checked the
// parse, and would have missed the entire reason for doing it.

import { analyzeBeam, parseSupports, parseLoads, parseLength, BeamInput, BeamResult } from "../beam";
import { Rat, ratInt, ratDiv, parseRatLiteral } from "../cas";

const R = (n: number, d = 1): Rat => ratDiv(ratInt(n), ratInt(d));

function ok(input: BeamInput): BeamResult {
  const r = analyzeBeam(input);
  if (!r.ok) throw new Error(`expected a solution, got: ${r.error}`);
  return r;
}

function expectExact(actual: Rat, expected: Rat, what: string): void {
  expect(`${what} = ${actual.n}/${actual.d}`).toBe(`${what} = ${expected.n}/${expected.d}`);
}

// ---------------------------------------------------------------------------
// Every field
// ---------------------------------------------------------------------------

describe("every numeric field accepts a fraction", () => {
  test("support positions", () => {
    const p = parseSupports("pin 0, roller 8/3");
    expect(p.errors).toEqual([]);
    expectExact(p.supports[1].x, ratDiv(R(8), R(3)), "x");
  });

  test("support options", () => {
    const p = parseSupports("roller 8 k=2/7 settle=1/400");
    expect(p.errors).toEqual([]);
    expectExact(p.supports[0].k as Rat, ratDiv(R(2), R(7)), "k");
    expectExact(p.supports[0].settle as Rat, ratDiv(R(1), R(400)), "settle");
  });

  test("point loads, in both the magnitude and the position", () => {
    const p = parseLoads("point 100/3 at 8/3");
    expect(p.errors).toEqual([]);
    const l = p.loads[0];
    if (l.kind !== "point") throw new Error("wrong kind");
    expectExact(l.p, ratDiv(R(100), R(3)), "P");
    expectExact(l.x, ratDiv(R(8), R(3)), "x");
  });

  test("uniform distributed loads", () => {
    const p = parseLoads("udl 7/2 from 1/3 to 16/3");
    expect(p.errors).toEqual([]);
    const l = p.loads[0];
    if (l.kind !== "udl") throw new Error("wrong kind");
    expectExact(l.w, ratDiv(R(7), R(2)), "w");
    expectExact(l.a, ratDiv(R(1), R(3)), "a");
    expectExact(l.b, ratDiv(R(16), R(3)), "b");
  });

  test("varying distributed loads, all four numbers", () => {
    const p = parseLoads("udl 1/3 to 9/2 from 1/4 to 15/2");
    expect(p.errors).toEqual([]);
    const l = p.loads[0];
    if (l.kind !== "ramp") throw new Error("wrong kind");
    expectExact(l.w1, ratDiv(R(1), R(3)), "w1");
    expectExact(l.w2, ratDiv(R(9), R(2)), "w2");
    expectExact(l.a, ratDiv(R(1), R(4)), "a");
    expectExact(l.b, ratDiv(R(15), R(2)), "b");
  });

  test("applied couples", () => {
    const p = parseLoads("moment 200/3 at 4/3");
    expect(p.errors).toEqual([]);
    const l = p.loads[0];
    if (l.kind !== "moment") throw new Error("wrong kind");
    expectExact(l.m, ratDiv(R(200), R(3)), "M");
  });

  test("the span and EI fields, which already went straight to the parser", () => {
    expectExact(parseLength("8/3") as Rat, ratDiv(R(8), R(3)), "L");
    expectExact(parseLength("21/2") as Rat, ratDiv(R(21), R(2)), "EI");
  });

  test("spacing around the slash does not matter", () => {
    for (const s of ["roller 8/3", "roller 8 / 3", "roller 8/ 3", "roller 8 /3"]) {
      const p = parseSupports(s);
      expect({ s, errors: p.errors }).toEqual({ s, errors: [] });
      expectExact(p.supports[0].x, ratDiv(R(8), R(3)), `x from "${s}"`);
    }
  });

  test("a negative fraction keeps its sign", () => {
    const p = parseSupports("roller 8 settle=-1/100");
    expect(p.errors).toEqual([]);
    expectExact(p.supports[0].settle as Rat, ratDiv(R(-1), R(100)), "settle");
  });
});

// ---------------------------------------------------------------------------
// Exact THROUGH the solve — the actual point
// ---------------------------------------------------------------------------

describe("a fraction stays exact all the way to the answer", () => {
  test("a load at L/3 on a simple span gives exactly 2P/3 and P/3", () => {
    // Reactions for a point load P at a from the left of a span L:
    //   R_left = P(L-a)/L, R_right = Pa/L.  With a = L/3: 2P/3 and P/3.
    const sup = parseSupports("pin 0, roller 9");
    const lds = parseLoads("point 30 at 9/3");
    expect([...sup.errors, ...lds.errors]).toEqual([]);
    const r = ok({ length: R(9), supports: sup.supports, loads: lds.loads });
    expectExact(r.reactions[0].forceExact, R(20), "R_left");
    expectExact(r.reactions[1].forceExact, R(10), "R_right");
  });

  test("a span typed as a fraction is not rounded first", () => {
    // Simply supported, udl w over the whole of L = 7/3. R = wL/2 = 7/6 · w.
    const r = ok({
      length: ratDiv(R(7), R(3)),
      supports: parseSupports("pin 0, roller 7/3").supports,
      loads: parseLoads("udl 1 from 0 to 7/3").loads,
    });
    expectExact(r.reactions[0].forceExact, ratDiv(R(7), R(6)), "R_left");
    expectExact(r.reactions[1].forceExact, ratDiv(R(7), R(6)), "R_right");
  });

  test("the fraction beats the decimal a user would otherwise have to type", () => {
    // 2.6666666667 is the best a decimal field allows for 8/3, and it is wrong.
    const exact = ok({
      length: R(8),
      supports: parseSupports("pin 0, roller 8").supports,
      loads: parseLoads("point 30 at 8/3").loads,
    });
    const rounded = ok({
      length: R(8),
      supports: parseSupports("pin 0, roller 8").supports,
      loads: parseLoads("point 30 at 2.6666666667").loads,
    });
    // R_left = P(L-a)/L = 30 · (8 - 8/3)/8 = 20 exactly.
    expectExact(exact.reactions[0].forceExact, R(20), "R_left exact");
    // The decimal cannot reach it: same to eight figures, not equal.
    expect(rounded.reactions[0].forceExact.n === exact.reactions[0].forceExact.n).toBe(false);
    expect(Math.abs(rounded.reactions[0].force - 20)).toBeLessThan(1e-8);
  });

  test("a fractional spring stiffness stays exact through an indeterminate solve", () => {
    const sup = parseSupports("fixed 0, roller 8 k=1/3");
    expect(sup.errors).toEqual([]);
    const r = ok({
      length: R(8),
      supports: sup.supports,
      loads: parseLoads("udl 6 from 0 to 8").loads,
      ei: R(1),
    });
    // Exact rational, and equilibrium closes exactly.
    const sum = r.reactions.reduce((s, re) => s + re.force, 0);
    expect(Math.abs(sum - 48)).toBeLessThan(1e-9);
    expect(r.reactions[1].forceExact.d).not.toBe(1n); // genuinely fractional
  });
});

// ---------------------------------------------------------------------------
// Still refuses what it should
// ---------------------------------------------------------------------------

describe("widening the fields did not widen what is accepted as a number", () => {
  test("a non-integer numerator or denominator is refused, not reinterpreted", () => {
    // parseRatLiteral takes integer/integer only. 1.5/3 matches the field
    // pattern and is then refused by the parser, which is the honest outcome.
    const p = parseSupports("roller 1.5/3");
    expect(p.errors.length).toBeGreaterThan(0);
    expect(p.supports).toHaveLength(0);
  });

  test("division by zero is refused", () => {
    const p = parseSupports("roller 8/0");
    expect(p.errors.length).toBeGreaterThan(0);
    expect(p.supports).toHaveLength(0);
  });

  test("a bare slash or a missing half is refused", () => {
    for (const s of ["roller /3", "roller 8/", "roller /", "roller 8//3"]) {
      const p = parseSupports(s);
      expect({ s, n: p.supports.length }).toEqual({ s, n: 0 });
      expect(p.errors.length).toBeGreaterThan(0);
    }
  });

  test("garbage that was refused before is still refused", () => {
    for (const s of ["roller eight", "wobble 8", "8 roller", "roller 8.5.5"]) {
      const p = parseSupports(s);
      expect({ s, n: p.supports.length }).toEqual({ s, n: 0 });
    }
  });

  test("bad load lines are still refused", () => {
    for (const s of ["point 30 at 1.5/3", "udl 5 from 0 to 8/0", "point / at /"]) {
      const p = parseLoads(s);
      expect({ s, n: p.loads.length }).toEqual({ s, n: 0 });
      expect(p.errors.length).toBeGreaterThan(0);
    }
  });

  test("plain decimals and scientific notation are untouched", () => {
    const p = parseSupports("pin 0, roller 8.5 k=5e4");
    expect(p.errors).toEqual([]);
    expectExact(p.supports[1].x, ratDiv(R(17), R(2)), "x");
    expectExact(p.supports[1].k as Rat, R(50000), "k");
    const l = parseLoads("udl 5 from 0 to 8\npoint 30 at 6\nmoment 200 at 4");
    expect(l.errors).toEqual([]);
    expect(l.loads).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// The advice the engine gives must still be typeable
// ---------------------------------------------------------------------------

describe("the messages mention fractions, and what they quote still parses", () => {
  test("the support error names the fraction form, and every form it SUGGESTS works", () => {
    const bad = "roller eight";
    const p = parseSupports(bad);
    expect(p.errors.join(" ")).toMatch(/fraction/i);
    const quoted = [...p.errors.join(" ").matchAll(/"([^"]+)"/g)]
      .map((m) => m[1])
      // The message echoes the offending input back, which is the one quoted
      // fragment that is NOT a suggestion and must not be fed to the parser.
      .filter((q) => q !== bad);
    const suggestions = quoted.filter((q) => /^(pin|roller|fixed)\b/i.test(q));
    expect(suggestions.length).toBeGreaterThan(0);
    for (const q of suggestions) {
      expect({ q, errors: parseSupports(q).errors }).toEqual({ q, errors: [] });
    }
  });

  test("the load error names the fraction form, and that form works", () => {
    const p = parseLoads("nonsense");
    expect(p.errors.join(" ")).toMatch(/fraction/i);
    expect(parseLoads("point 30 at 8/3").errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Case insensitivity, which the rewrite could easily have dropped
// ---------------------------------------------------------------------------

describe("every rewritten pattern kept its case-insensitive flag", () => {
  // Rebuilding five inline regex literals as `new RegExp(...)` moves the flags
  // from a trailing /i to a second argument, which is exactly the kind of thing
  // that gets lost in one of five. No existing test used uppercase on the
  // VARYING-load form, so a dropped flag there would have shipped silently.
  test.each([
    ["support", "ROLLER 8/3"],
    ["support option", "ROLLER 8 K=1/3"],
    ["point load", "POINT 30 AT 8/3"],
    ["uniform load", "UDL 5 FROM 0 TO 8"],
    ["varying load", "UDL 0 TO 9 FROM 1/3 TO 6"],
    ["moment", "MOMENT 200/3 AT 4"],
  ])("%s: %s", (_what, text) => {
    if (/^(ROLLER|PIN|FIXED)/.test(text)) {
      const p = parseSupports(text);
      expect({ text, errors: p.errors }).toEqual({ text, errors: [] });
      expect(p.supports).toHaveLength(1);
    } else {
      const p = parseLoads(text);
      expect({ text, errors: p.errors }).toEqual({ text, errors: [] });
      expect(p.loads).toHaveLength(1);
    }
  });

  test("the varying form is still preferred over the uniform one, in either case", () => {
    for (const s of ["udl 0 to 9 from 0 to 6", "UDL 0 TO 9 FROM 0 TO 6"]) {
      const p = parseLoads(s);
      expect({ s, errors: p.errors }).toEqual({ s, errors: [] });
      expect({ s, kind: p.loads[0].kind }).toEqual({ s, kind: "ramp" });
    }
  });

  test("mixed case works too", () => {
    expect(parseLoads("Udl 0 To 9 From 1/3 To 6").errors).toEqual([]);
    expect(parseSupports("Roller 8/3 Settle=1/400").errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The option/position boundary — found by an independent bug hunt
// ---------------------------------------------------------------------------

describe("a malformed option value cannot leak into the support position", () => {
  // Allowing fractions made the old stripper unsafe: it replaced each matched
  // `key=value` with a SPACE, and NUM tolerates whitespace around its slash, so
  // whatever the value pattern could not swallow rejoined the position across
  // that space. `roller 8 k=1/2/3` silently became a roller at 8/3 — no error,
  // and on a two-support beam it flipped a reaction into uplift. These are the
  // exact inputs that did it.
  test.each([
    "roller 8 k=1/2/3",
    "roller 8 settle=1/2/3",
    "roller 8 k=1/2 /3",
    "pin 0 k=1/2/3",
    "roller 8.5 k=1/2/3",
    "roller 8/3 k=5/6/7",
    "roller 8 k=1/2/3/4",
    "roller 8 settle=0.01/2",
  ])("%s is refused rather than silently relocated", (s) => {
    const p = parseSupports(s);
    expect({ s, supports: p.supports.length }).toEqual({ s, supports: 0 });
    expect(p.errors.length).toBeGreaterThan(0);
  });

  test("the specific silent relocation is gone: no support ever lands at 8/3 here", () => {
    for (const s of ["roller 8 k=1/2/3", "roller 8 settle=1/2/3", "roller 8 k=1/2 /3"]) {
      const p = parseSupports(s);
      for (const sup of p.supports) {
        expect({ s, x: `${sup.x.n}/${sup.x.d}` }).not.toEqual({ s, x: "8/3" });
      }
    }
  });

  test("an option before the position is refused, as the docs always claimed", () => {
    const p = parseSupports("k=5 roller 8");
    expect(p.supports).toHaveLength(0);
    expect(p.errors.length).toBeGreaterThan(0);
  });

  test("trailing junk after a valid option is refused rather than ignored", () => {
    for (const s of ["roller 8 k=5 junk", "roller 8 k=5 8", "roller 8 k=5 /"]) {
      const p = parseSupports(s);
      expect({ s, supports: p.supports.length }).toEqual({ s, supports: 0 });
    }
  });

  test("but everything legitimate still parses, including fractional options", () => {
    for (const s of [
      "roller 8",
      "roller 8/3",
      "roller 8 / 3",
      "roller 8 k=5e4",
      "roller 8 k=1/3",
      "roller 8/3 k=1/3",
      "roller 8/3 k=1/3 settle=1/400",
      "roller 8 settle=-1/100",
      "roller 8 K = 5",
      "fixed 0",
      "pin 0",
    ]) {
      const p = parseSupports(s);
      expect({ s, errors: p.errors }).toEqual({ s, errors: [] });
      expect({ s, n: p.supports.length }).toEqual({ s, n: 1 });
    }
  });

  test("a multi-support line still splits correctly with options on each", () => {
    const p = parseSupports("pin 0 k=1/3, roller 8/3 settle=1/400");
    expect(p.errors).toEqual([]);
    expect(p.supports).toHaveLength(2);
    expectExact(p.supports[0].k as Rat, ratDiv(R(1), R(3)), "k0");
    expectExact(p.supports[1].x, ratDiv(R(8), R(3)), "x1");
    expectExact(p.supports[1].settle as Rat, ratDiv(R(1), R(400)), "settle1");
  });
});
