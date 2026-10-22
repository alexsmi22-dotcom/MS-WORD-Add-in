// Adversarial-review pins for the significant-figures verb (each failed before
// its fix). Expected values: the textbook rules and Python's decimal module
// (ROUND_HALF_UP): Decimal(45) * Decimal('1.234') = 55.530 → 2 figures → 56;
// Decimal(20) / Decimal('3.5') = 5.714… → 1 figure (20 is ambiguous) → 6;
// Decimal(2) / Decimal(3) quantize 0.001 → 0.667; Decimal('2.0') ** 2 = 4.00 → 4.0.

import { studentPackVerb } from "../studentPack";

const ask = (q: string) => {
  const r = studentPackVerb(q);
  if (!r) throw new Error(`not answered: ${q}`);
  return r;
};
const first = (q: string): string => ask(q).lines[0]?.text ?? "";
const all = (q: string): string => {
  const r = ask(q);
  return [r.title, ...r.lines.map((l) => l.text), ...r.caveats].join("\n");
};

describe("B1: unit words are units, not counts", () => {
  it("1500 feet is a measurement with ambiguous zeros, not exact", () => {
    expect(first("sig figs in 1500 feet")).toBe("1500 feet: 2 to 4 significant figures — AMBIGUOUS");
    expect(all("sig figs in 1500 feet")).toMatch(/“feet” is a unit/);
  });
  it.each(["feet", "miles", "inches", "newtons", "metres", "meters", "liters", "milliliters", "ounces", "calories", "years"])("100 %s is ambiguous, never exact", (w) => {
    expect(first(`sig figs in 100 ${w}`)).toBe(`100 ${w}: 1 to 3 significant figures — AMBIGUOUS`);
  });
  it("45 newtons × 1.234 = 56 newtons (2 figures, from 45)", () => {
    expect(first("45 newtons × 1.234 sig figs")).toBe("= 56 newtons  (2 significant figures)");
  });
  it("20 miles / 3.5 = 6 miles (20 read with its 1 certain figure)", () => {
    expect(first("20 miles / 3.5 sig figs")).toBe("= 6 miles  (1 significant figure)");
  });
  it("an unrecognised word after a whole number is a COUNT (exact), and said so; count words stay exact", () => {
    expect(first("sig figs in 1500 widgets")).toBe("1500 widgets: exact — unlimited significant figures");
    expect(all("sig figs in 1500 widgets")).toMatch(/read as a COUNT/);
    // The old default, restored (review round 3): 12 donuts is exact, so the product has 2.50's 3 figures.
    expect(first("12 donuts × 2.50 g with sig figs")).toBe("= 30.0 g  (3 significant figures)");
    expect(all("12 donuts × 2.50 g with sig figs")).toMatch(/“donuts” is not a unit this recognises, so 12 donuts is read as a COUNT \(exact\)/);
    expect(first("sig figs in 3 dozen")).toBe("3 dozen: exact — unlimited significant figures");
    expect(first("sig figs in 4 legs")).toBe("4 legs: exact — unlimited significant figures");
    expect(first("3 sides × 2.0 sig figs")).toBe("= 6.0  (2 significant figures)");
    expect(first("sig figs in 30 students")).toBe("30 students: exact — unlimited significant figures");
    expect(first("how many sig figs in 12 eggs")).toBe("12 eggs: exact — unlimited significant figures");
    expect(first("sig figs in 1500 widgets exact")).toBe("1500 widgets: exact — unlimited significant figures");
    expect(ask("2.5 eggs × 3.0 sig figs").caveats[0]).toMatch(/is not a count \(a count is a whole number\)/);
  });
  it("symbols are typeset and carry no reading caveat; only spelled names keep theirs", () => {
    expect(first("sig figs in 4.50 umol")).toBe("4.50 µmol: 3 significant figures");
    expect(first("sig figs in 25.0 degC")).toBe("25.0 °C: 3 significant figures");
    for (const q of ["sig figs in 101 kPa", "sig figs in 5 min", "sig figs in 4.50 umol"]) {
      expect(all(q)).not.toMatch(/is a unit, so/);
    }
    expect(first("sig figs in 120 kPa")).toBe("120 kPa: 2 to 3 significant figures — AMBIGUOUS");
  });
  it("compound units with a bracketed denominator are read", () => {
    expect(first("sig figs in 5.0 W/(m²·K)")).toBe("5.0 W/(m²·K): 2 significant figures");
    expect(first("10.0 J/(mol·K) × 2.0 sig figs")).toBe("= 2.0×10¹ J/(mol·K)  (2 significant figures)");
    expect(first("10.0 W/(m^2*K) × 2.0 sig figs")).toBe("= 2.0×10¹ W/(m²·K)  (2 significant figures)");
    expect(first("3.0 m/(2.0) sig figs")).toBe("= 1.5 m  (2 significant figures)");
  });
  it("3 feet + 2 ft adds (same unit, two spellings); feet + seconds refuses", () => {
    expect(first("3.0 feet + 2.0 ft sig figs")).toBe("= 5.0 feet  (2 significant figures)");
    expect(ask("3.0 feet + 2.0 seconds sig figs").caveats[0]).toMatch(/different units/);
  });
});

describe("B2: huge exponents refuse fast", () => {
  it("1.0e9999999 + 1.0e-9999999 refuses by name in well under a second", () => {
    const t0 = Date.now();
    const r = ask("1.0e9999999 + 1.0e-9999999 sig figs");
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.lines).toHaveLength(0);
    expect(r.caveats[0]).toMatch(/power of ten.*beyond/);
    expect(r.caveats[0]).not.toMatch(/\de\d/);
  });
  it("a long product chain of 9.9×10⁹⁹⁹ refuses by size, quickly", () => {
    const q = Array.from({ length: 140 }, () => "9.9e999").join(" * ") + " sig figs";
    const t0 = Date.now();
    const r = ask(q);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.caveats[0]).toMatch(/too large|too small/);
  });
  it("a value and uncertainty more than 60 places apart refuses instead of printing them all", () => {
    const r = ask("round 123456789012345678901234567890123456789012345678901234567890.5 ± 0.1 to the uncertainty");
    expect(r.lines).toHaveLength(0);
    expect(r.caveats[0]).toMatch(/would take 61 digits, more than the 60 this writes out/);
  });
  it("rounding 1×10⁹⁹⁹ keeps the answer short", () => {
    const t = all("round 1.23456e999 to 3 sig figs");
    expect(first("round 1.23456e999 to 3 sig figs")).toBe("1.23456×10⁹⁹⁹ → 1.23×10⁹⁹⁹  (3 significant figures)");
    expect(t.length).toBeLessThan(2000);
  });
});

describe("6: a value that rounds to zero", () => {
  it("round 4 ± 23 to the uncertainty → (0 ± 2)×10¹, value 4 → 0", () => {
    const t = all("round 4 ± 23 to the uncertainty");
    expect(first("round 4 ± 23 to the uncertainty")).toBe("4 ± 23 → (0 ± 2)×10¹");
    expect(t).toMatch(/Value 4 rounded to 10¹ → 0\./);
    expect(t).not.toMatch(/→ 00/);
  });
});

describe("8: digit grouping and decimal commas refuse by name", () => {
  it("1,200 / 1,5 / 1 200", () => {
    expect(ask("sig figs in 1,200").caveats[0]).toMatch(/write 1200 without the comma/);
    expect(ask("sig figs in 1,5").caveats[0]).toMatch(/decimal comma: write 1\.5/);
    expect(ask("sig figs in 1 200").caveats[0]).toMatch(/write 1200 without the space/);
  });
  it("ordinary inputs still read", () => {
    expect(first("1.013 sig figs")).toBe("1.013: 4 significant figures");
    expect(first("12.11 + 18.0 sig figs")).toBe("= 30.1  (3 significant figures)");
    expect(ask("sig figs in 1.5, 2.0").caveats[0]).toMatch(/one number at a time/);
  });
});

describe("9: temperatures", () => {
  it("98.6 °F has 3 figures; 100 °C is ambiguous", () => {
    expect(first("sig figs in 98.6 °F")).toBe("98.6 °F: 3 significant figures");
    expect(first("sig figs in 100 °C")).toBe("100 °C: 1 to 3 significant figures — AMBIGUOUS");
  });
});

describe("10: phrasings", () => {
  it("a 'sig figs:' prefix, '= ?' and ^ with a whole-number exponent", () => {
    expect(first("sig figs: 3.40 × 2.1")).toBe("= 7.1  (2 significant figures)");
    expect(first("Sig figs: 0.00450")).toBe("0.00450: 3 significant figures");
    expect(first("3.40 × 2.1 = ? sig figs")).toBe("= 7.1  (2 significant figures)");
    expect(first("2.0 ^ 2 sig figs")).toBe("= 4.0  (2 significant figures)");
    expect(first("2.0² sig figs")).toBe("= 4.0  (2 significant figures)");
    expect(all("2.0 ^ 2 sig figs")).toMatch(/a power keeps the base's figures/);
    expect(first("3.00 ^ -1 sig figs")).toBe("= 0.333  (3 significant figures)");
  });
  it("a sign binds looser than the power: −2.0² = −4.0; 1.5 × −2.0² = −6.0", () => {
    expect(first("-2.0^2 sig figs")).toBe("= −4.0  (2 significant figures)");
    expect(first("1.5 * -2.0^2 sig figs")).toBe("= −6.0  (2 significant figures)");
  });
  it("a compound unit after a number reads (5 m/s^2 → m/s²)", () => {
    expect(first("sig figs in 5 m/s^2")).toBe("5 m/s²: 1 significant figure");
  });
  it("a non-integer power refuses by name", () => {
    expect(ask("2.0 ^ 0.5 sig figs").caveats[0]).toMatch(/whole-number power/);
  });
  it("a chained power is refused, never read left to right (2.0^2^3 is 256, not 64)", () => {
    expect(ask("2.0^2^3 sig figs").caveats[0]).toMatch(/A power of a power is not read here/);
    expect(first("(2.0^2)^3 sig figs")).toBe("= 64  (2 significant figures)");
  });
  it("a tiny tie names the half-to-even answer in scientific form", () => {
    const t = all("round 1.25e-900 ± 0.3e-900 to the uncertainty");
    expect(t).toMatch(/round-half-to-even would give 1\.2×10⁻⁹⁰⁰/);
    expect(t.length).toBeLessThan(2000);
  });
});

describe("nits", () => {
  it("an exact quotient has one sign, not '= ≈'", () => {
    expect(first("1 exact / 3 exact sig figs")).toBe("≈ 0.333333333333  (every input is exact, so the result is exact)");
  });
  it("a calculation rounded to an asked count: 2/3 to 3 sig figs = 0.667, the rules' answer noted", () => {
    expect(first("2/3 to 3 sig figs")).toBe("= 0.667  (3 significant figures, as asked)");
    expect(all("2/3 to 3 sig figs")).toMatch(/By the sig-fig rules for MEASURED inputs the result carries 1 significant figure \(0\.7\)/);
    expect(first("apply the 3 sf rule to 2/3")).toBe("= 0.667  (3 significant figures, as asked)");
    expect(first("apply the 3sf rule to 2/3")).toBe("= 0.667  (3 significant figures, as asked)");
  });
  it("x between two numbers is ×", () => {
    expect(first("2.0x3.0 sig figs")).toBe("= 6.0  (2 significant figures)");
  });
  it("a bare whole number in a calculation is said to be read as measured", () => {
    expect(all("3.0 + 2 sig figs")).toMatch(/2 is read as a MEASURED value/);
  });
  it("display contract on the new paths", () => {
    for (const q of ["sig figs in 1500 feet", "2/3 to 3 sig figs", "3.00 ^ -1 sig figs", "round 4 ± 23 to the uncertainty", "sig figs in 98.6 °F"]) {
      expect(all(q)).not.toMatch(/\^|\de[+-]?\d|(^|[\s(=])-\d/);
    }
    // The new refusals: no caret, no e-notation, no em dash.
    const EM = String.fromCharCode(0x2014);
    for (const q of ["sig figs in 1,200", "sig figs in 1,5", "sig figs in 1 200", "2.0 m ^ 2 sig figs", "2.0^2^3 sig figs", "2.0 ^ 0.5 sig figs", "round 123456789012345678901234567890123456789012345678901234567890.5 ± 0.1 to the uncertainty", "1.0e9999999 + 1 sig figs"]) {
      const c = ask(q).caveats[0];
      expect(c).not.toContain(EM);
      expect(c).not.toMatch(/\^|\de[+-]?\d|(^|[\s(=])-\d/);
    }
  });
});

describe("abbreviations after a whole number are measurements (e67d34a review)", () => {
  const first = (q: string): string => studentPackVerb(q)!.lines[0].text;
  test.each([
    ["100 lbs × 2.5 sig figs", "= 3×10² lbs  (1 significant figure)"],
    ["24 hrs × 3.15 sig figs", "= 76 hrs  (2 significant figures)"],
    ["3 pmol × 1.234 sig figs", "= 4 pmol  (1 significant figure)"],
    ["20 tbsp × 1.5 sig figs", "= 3×10¹ tbsp  (1 significant figure)"],
    ["100 PSI × 2.5 sig figs", "= 3×10² PSI  (1 significant figure)"],
  ])("%s", (q, want) => expect(first(q)).toBe(want));
  test("an unknown abbreviation is measured, says so, and “exact” still makes it a count", () => {
    expect(first("sig figs in 100 pkts")).toMatch(/AMBIGUOUS/);
    expect(studentPackVerb("sig figs in 100 pkts")!.caveats!.join(" ")).toMatch(/“pkts” looks like a unit .* write “100 pkts exact”/);
    expect(first("sig figs in 100 pkts exact")).toMatch(/exact/);
  });
  test("counted nouns stay exact", () => {
    expect(first("12 donuts × 2.50 g with sig figs")).toBe("= 30.0 g  (3 significant figures)");
    expect(first("3 dozen × 2.0 sig figs")).toBe("= 6.0  (2 significant figures)");
  });
});
