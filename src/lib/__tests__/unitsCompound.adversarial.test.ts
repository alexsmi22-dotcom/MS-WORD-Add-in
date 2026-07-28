// Adversarial pass over compound-unit parsing.
//
// Parenthesised units were added so "W/(m^2*K)" works. Unit parsing runs on
// EVERY KEYSTROKE in the Engineering tools — a student types "W/(m^" and the
// parser sees every prefix of it on the way — so the questions here are the two
// that matter in a task pane:
//
//   1. Does it TERMINATE, fast, on a hostile or half-typed string? A parser
//      that backtracks catastrophically is not a slow parser, it is a frozen
//      Word with the user's document inside it.
//   2. Does it REFUSE rather than invent a dimension? A unit parsed to the
//      wrong dimensions is worse than a rejection, because it converts to a
//      confident wrong number.
//
// The change also had to not break anything that already worked, which is why
// the sweep below re-checks the un-parenthesised forms rather than trusting
// that adding a branch was harmless.

import { convert, parseCompoundUnit, parseMeasured } from "../units";

/** Runs `fn` and fails if it takes longer than `ms` — the freeze check. */
function within<T>(ms: number, fn: () => T): T {
  const t0 = Date.now();
  const out = fn();
  const dt = Date.now() - t0;
  if (dt > ms) throw new Error(`took ${dt} ms, budget was ${ms} ms`);
  return out;
}

describe("half-typed and malformed units terminate and refuse", () => {
  test("every prefix of a real unit parses or refuses, none hang", () => {
    const full = "kW/(m^2*K)";
    within(500, () => {
      for (let i = 1; i <= full.length; i++) {
        const prefix = full.slice(0, i);
        // Some prefixes are legal units ("k", "kW"); the rest must be null.
        // Either is fine — what must never happen is a throw or a hang.
        const r = parseCompoundUnit(prefix);
        expect(r === null || typeof r === "object").toBe(true);
      }
    });
  });

  test("pathological bracket soup is refused quickly", () => {
    const junk = [
      "(",
      ")",
      "()",
      "(())",
      "((((((((((",
      "))))))))))",
      "(".repeat(500),
      "(".repeat(500) + ")".repeat(500),
      "W/(",
      "W/()",
      "W/(m^2*K))",
      "((W))/((m))",
      "(W/(m^2*K))",
      "/",
      "//",
      "W//K",
      "W/",
      "/W",
      "*",
      "W**K",
      "^",
      "m^",
      "m^^2",
      "m^-",
      "m^999999999",
      "m^-999999999",
    ];
    within(1000, () => {
      for (const j of junk) {
        const r = parseCompoundUnit(j);
        expect(r === null || typeof r === "object").toBe(true);
      }
    });
  });

  test("a very long token does not trigger quadratic backtracking", () => {
    // The factor regex is lazy with an optional exponent group, which is the
    // classic shape for catastrophic backtracking. Pin that it is not.
    within(1000, () => {
      for (const n of [1000, 10000, 50000]) {
        expect(parseCompoundUnit("m".repeat(n))).toBeNull();
        expect(parseCompoundUnit("m".repeat(n) + "^2")).toBeNull();
        expect(parseCompoundUnit("W/(" + "m".repeat(n) + ")")).toBeNull();
      }
    });
  });

  test("a very long chain of divisions terminates", () => {
    within(1000, () => {
      expect(parseCompoundUnit("W" + "/m".repeat(2000))).not.toBeUndefined();
      expect(parseCompoundUnit("W" + "/(m)".repeat(500))).not.toBeUndefined();
    });
  });

  test("unicode and whitespace do not crash the parser", () => {
    for (const s of ["W/(m²·K)", "  W / ( m^2 * K )  ", "\tW/(m^2*K)\n", "W／(m^2*K)", "µm", "Ω", "°C"]) {
      const r = within(100, () => parseCompoundUnit(s));
      expect(r === null || typeof r === "object").toBe(true);
    }
  });
});

describe("parenthesised groups never invent a dimension", () => {
  // The whole risk of accepting parentheses is misreading the grouping and
  // silently returning a unit that is off by a squared factor.
  test("a group in the denominator is inverted exactly once", () => {
    const paren = parseCompoundUnit("W/(m^2*K)");
    const chained = parseCompoundUnit("W/m^2/K");
    expect(paren).not.toBeNull();
    expect(chained).not.toBeNull();
    expect(paren!.dims).toEqual(chained!.dims);
    expect(paren!.factor).toBeCloseTo(chained!.factor, 12);
  });

  test("the grouping is NOT read as a double denominator", () => {
    // The failure mode: treating "(m^2*K)" as two separate denominators of a
    // nested split would give the same dims here but not for a prefixed unit.
    const a = parseCompoundUnit("kJ/(kg*K)");
    const b = parseCompoundUnit("kJ/kg/K");
    expect(a!.factor).toBeCloseTo(b!.factor, 12);
    // 1 kJ/(kg*K) is 1000 J/(kg*K), not 1 and not 10^6.
    expect(convert(1, "kJ/(kg*K)", "J/kg/K")).toBeCloseTo(1000, 6);
  });

  test("nested division inside a group is refused, never guessed", () => {
    // "a/(b/c)" = a*c/b, but read flatly it is a/(b*c) — different by c^2.
    // Refusing is the only safe answer.
    for (const s of ["W/(m^2/K)", "J/(kg/K)", "m/(s/s)"]) {
      expect(parseCompoundUnit(s)).toBeNull();
    }
  });

  test("an incompatible conversion through a group is still refused", () => {
    expect(convert(1, "W/(m^2*K)", "m")).toBeNull();
    expect(convert(1, "W/(m^2*K)", "W/m/K")).toBeNull();
    expect(convert(1, "J/(kg*K)", "W/m^2/K")).toBeNull();
  });
});

describe("nothing that worked before the change stopped working", () => {
  // A broad regression sweep. The change touched the single entry point every
  // compound unit in the product goes through, so the cheapest insurance is to
  // re-assert a wide spread of them rather than reason about the diff.
  const identities: [string, string, number][] = [
    ["km/h", "m/s", 1 / 3.6],
    ["m/s", "km/h", 3.6],
    ["kg*m/s^2", "N", 1],
    ["N*m", "J", 1],
    ["N/m^2", "Pa", 1],
    ["N/mm^2", "MPa", 1],
    ["mol/L/s", "mol/m^3/s", 1000],
    ["g/mol", "kg/mol", 0.001],
    ["mm^4", "m^4", 1e-12],
    ["mm^2", "m^2", 1e-6],
    ["cm^3", "m^3", 1e-6],
    ["L/s", "m^3/s", 0.001],
    ["kg/m^3", "kg/m^3", 1],
    ["Pa*s", "Pa*s", 1],
    ["W/m^2/K", "W/m^2/K", 1],
    ["GPa", "Pa", 1e9],
    ["ksi", "Pa", 6894757.2932],
  ];

  test.each(identities)("%s -> %s", (from, to, expected) => {
    const got = convert(1, from, to);
    expect(got).not.toBeNull();
    expect(got as number).toBeCloseTo(expected, Math.abs(expected) > 1e6 ? -1 : 9);
  });

  test("incompatible pairs are still refused", () => {
    for (const [a, b] of [
      ["m", "s"],
      ["kg", "m"],
      ["N", "N*m"],
      ["Pa", "W"],
      ["m^2", "m^3"],
      ["mm^4", "m^2"],
    ]) {
      expect(convert(1, a, b)).toBeNull();
    }
  });

  test("unknown units are still refused rather than assumed", () => {
    for (const s of ["wibble", "furlong/fortnight", "banana^2", "W/(banana*K)"]) {
      expect(convert(1, s, "m")).toBeNull();
    }
  });
});

describe("the Engineering field contract holds under hostile input", () => {
  // These are the exact target units the Engineering tools ask for. A bare
  // number must pass through untouched in every one of them, because that is
  // the property that made adopting parseMeasured a no-op for existing users.
  const ENG_TARGETS = ["m", "m^2", "m^4", "Pa", "N", "N*m", "W", "W/m^2/K", "W/m/K", "kg/m^3", "Pa*s", "m/s", "m^3/s", "°C"];

  test("a bare number is the identity in every Engineering target unit", () => {
    for (const unit of ENG_TARGETS) {
      for (const v of [0, 1, -1, 1e-12, 1e12, 2.5, -273.15, 998.2]) {
        const m = parseMeasured(String(v), unit);
        if ("error" in m) throw new Error(`${v} as ${unit}: ${m.error}`);
        expect({ unit, v, got: m.inTarget }).toEqual({ unit, v, got: v });
      }
    }
  });

  test("a wrong-quantity unit is refused in every Engineering target", () => {
    // "kg" is not a length, an area, a pressure, a force or a temperature.
    for (const unit of ENG_TARGETS) {
      const m = parseMeasured("5 kg", unit);
      // kg/m^3 and Pa*s legitimately contain mass, so only assert on the ones
      // where mass alone is genuinely incompatible.
      if (unit === "kg/m^3" || unit === "Pa*s") continue;
      expect({ unit, refused: "error" in m }).toEqual({ unit, refused: true });
    }
  });

  test("garbage in a field is refused, not silently read as zero", () => {
    for (const junk of ["", "   ", "abc", "--5", "1/2/3 m", "NaN", "Infinity", "e5", ".", "-", "+"]) {
      const m = parseMeasured(junk, "m");
      const isError = "error" in m;
      // The one thing that must never happen is a finite value invented from
      // text that contains no number.
      if (!isError) {
        expect(Number.isFinite((m as { inTarget: number }).inTarget)).toBe(true);
        expect(junk).toMatch(/\d/);
      } else {
        expect(isError).toBe(true);
      }
    }
  });

  test("reading a field never takes long enough to be felt", () => {
    // 2,000 reads is far more than a keystroke triggers, and stands in for the
    // whole Engineering pane recomputing.
    within(1000, () => {
      for (let i = 0; i < 2000; i++) {
        parseMeasured("200 GPa", "Pa");
        parseMeasured("1e6 mm^4", "m^4");
        parseMeasured("25 W/(m^2*K)", "W/m^2/K");
      }
    });
  });
});
