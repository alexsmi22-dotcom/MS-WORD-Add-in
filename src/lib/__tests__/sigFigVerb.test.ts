// Significant figures as a Solve verb. Expected values: the textbook rules
// themselves (counting is a definition), and Python's decimal module for every
// rounding (ROUND_HALF_UP and ROUND_HALF_EVEN, quantize) and every exact
// product/sum — run once, the results pasted below with the call that made
// them. Every case goes through studentPackVerb, the function the pane calls
// with the RAW input.

import { studentPackVerb } from "../studentPack";
import { roundToPlace, floorLog10, displayRounded } from "../sigFigVerb";

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

describe("counting the figures of a typed number", () => {
  const cases: [string, string][] = [
    ["how many significant figures in 0.00450", "0.00450: 3 significant figures"],
    ["sig figs in 1200.", "1200.: 4 significant figures"],
    ["significant figures of 1.200×10³", "1.200×10³: 4 significant figures"],
    ["how many sig figs in 1.200 x 10^3", "1.200×10³: 4 significant figures"],
    ["how many sig figs in 1.200e3", "1.200×10³: 4 significant figures"],
    ["sig figs in 40.05", "40.05: 4 significant figures"],
    ["sig figs in −47.0", "−47.0: 3 significant figures"],
    ["sig figs in 5", "5: 1 significant figure"],
  ];
  it.each(cases)("%s", (q, want) => expect(first(q)).toBe(want));

  it("trailing zeros of a whole number are AMBIGUOUS, and it says so with both readings", () => {
    const t = all("sig figs in 1200");
    expect(first("sig figs in 1200")).toBe("1200: 2 to 4 significant figures — AMBIGUOUS");
    expect(t).toMatch(/1\.200×10³ if all 4 are measured; 1\.2×10³ if only 2/);
    expect(first("how many significant figures in 100")).toBe("100: 1 to 3 significant figures — AMBIGUOUS");
  });

  it("the rules that applied are shown", () => {
    const t = all("how many significant figures in 0.00450");
    expect(t).toMatch(/Leading zeros only place the decimal point/);
    expect(t).toMatch(/Trailing zeros after a decimal point are significant/);
    expect(t).toMatch(/Significant digits: 4, 5, 0\./);
    expect(all("sig figs in 40.05")).toMatch(/Zeros between non-zero digits are significant/);
  });

  it("a count of things is exact; a zero has no figures, only a place", () => {
    expect(first("how many sig figs in 12 eggs")).toBe("12 eggs: exact — unlimited significant figures");
    expect(first("sig figs in 0.0")).toBe("0.0: no significant figures in the usual count");
  });

  it("an ambiguous 1200 limits a sum at the hundreds place (its last CERTAIN digit)", () => {
    // 1200 + 3.0: read with 2 figures, last place 10² → 1203 rounds to 1.2×10³.
    expect(first("1200 + 3.0 sig figs")).toBe("= 1.2×10³  (2 significant figures)");
    // 1200. + 3.0: known to units → 1203.
    expect(first("1200. + 3.0 sig figs")).toBe("= 1203  (4 significant figures)");
  });
});

describe("rounding to n significant figures (Python decimal quantize, ROUND_HALF_UP)", () => {
  // Decimal('0.0045678').quantize(Decimal('0.00001'), ROUND_HALF_UP) = 0.00457
  it("0.0045678 → 0.00457", () => expect(first("round 0.0045678 to 3 sig figs")).toBe("0.0045678 → 0.00457  (3 significant figures)"));
  it("12345 → 1.2×10⁴ (the plain 12000 would be ambiguous)", () => {
    expect(first("round 12345 to 2 significant figures")).toBe("12345 → 1.2×10⁴  (2 significant figures)");
    expect(all("round 12345 to 2 significant figures")).toMatch(/Written out that is 12000/);
  });
  // Decimal('2.675').quantize(Decimal('0.01'), ROUND_HALF_UP) = 2.68 — a binary
  // double holds 2.67499999…, which naive rounding sends to 2.67.
  it("2.675 → 2.68: a real decimal tie, not a binary 2.67499…", () => expect(first("round 2.675 to 3 sig figs")).toBe("2.675 → 2.68  (3 significant figures)"));
  // ROUND_HALF_UP 2.5 → 3, ROUND_HALF_EVEN → 2; −2.5 → −3 / −2.
  it("ties: away from zero, and the half-to-even answer named", () => {
    expect(first("round 2.5 to 1 sig fig")).toBe("2.5 → 3  (1 significant figure)");
    expect(all("round 2.5 to 1 sig fig")).toMatch(/round-half-to-even rule some texts use would give 2 instead/);
    expect(first("round −2.5 to 1 sig fig")).toBe("−2.5 → −3  (1 significant figure)");
  });
  it("a carry keeps the figure count: 9.996 → 10.0", () => expect(first("round 9.996 to 3 sig figs")).toBe("9.996 → 10.0  (3 significant figures)"));
  it("3 s.f. and UK '3 sf' spellings", () => {
    expect(first("round 3.14159 to 3 s.f.")).toBe("3.14159 → 3.14  (3 significant figures)");
    expect(first("3.14159 to 4 sf")).toBe("3.14159 → 3.142  (4 significant figures)");
  });
  it("refuses to ADD figures", () => {
    const r = ask("round 0.12 to 4 sig figs");
    expect(r.lines).toHaveLength(0);
    expect(r.caveats[0]).toMatch(/carries only 2 significant figures; quoting it to 4 would add digits/);
  });
});

describe("arithmetic by the textbook rules (values: Python Decimal products and sums)", () => {
  // Decimal('3.40') * Decimal('2.1') = 7.140 → 2 figures → 7.1
  it("× ÷: fewest significant figures — 3.40 × 2.1 = 7.1", () => {
    expect(first("3.40 × 2.1 with sig figs")).toBe("= 7.1  (2 significant figures)");
    expect(first("3.40 x 2.1 sig figs")).toBe("= 7.1  (2 significant figures)");
    expect(first("3.40 times 2.1 with sig figs")).toBe("= 7.1  (2 significant figures)");
    expect(all("3.40 × 2.1 with sig figs")).toMatch(/3\.40 × 2\.1 = 7\.14 {2}\(× ÷ rule: the FEWEST SIGNIFICANT FIGURES — 3\.40 has 3, 2\.1 has 2 → 2 significant figures\)/);
  });
  // 12.11 + 18.0 + 1.013 = 31.123 → tenths → 31.1
  it("+ −: fewest decimal places — 12.11 + 18.0 + 1.013 = 31.1", () => {
    expect(first("12.11 + 18.0 + 1.013 sig figs")).toBe("= 31.1  (3 significant figures)");
    expect(all("12.11 + 18.0 + 1.013 sig figs")).toMatch(/last place 10⁻¹/);
  });
  // Decimal(12) * Decimal('0.0450') = 0.5400 → 3 figures → 0.540
  it("an exact count does not limit: 12 eggs × 0.0450 kg = 0.540 kg", () => {
    expect(first("12 eggs × 0.0450 kg with sig figs")).toBe("= 0.540 kg  (3 significant figures)");
    expect(all("12 eggs × 0.0450 kg with sig figs")).toMatch(/a count of things is exact/);
  });
  it("a number marked exact does not limit: 2.54 exact × 12.0 = 30.5", () => {
    // 2.54 × 12.0 = 30.480 → 3 figures (from 12.0) → 30.5
    expect(first("2.54 exact * 12.0 sig figs")).toBe("= 30.5  (3 significant figures)");
  });
  // (3.0 + 4.12) × 2.000 = 14.24000; the sum is good to tenths (7.1, 2 figures) → 14
  it("mixed operations track each step and round once: (3.0 + 4.12) × 2.000 = 14", () => {
    expect(first("(3.0 + 4.12) × 2.000 sig figs")).toBe("= 14  (2 significant figures)");
    expect(all("(3.0 + 4.12) × 2.000 sig figs")).toMatch(/Intermediate results are carried unrounded/);
  });
  it("100 ÷ 3 with ambiguous zeros reads 1 figure and says so: 3×10¹", () => {
    expect(first("100 / 3 sig figs")).toBe("= 3×10¹  (1 significant figure)");
    expect(all("100 / 3 sig figs")).toMatch(/100 has ambiguous trailing zeros; it is read with the 1 significant figure that is certain/);
  });
  it("a subtraction that loses every figure says so", () => {
    expect(first("1.00 - 0.999 with sig figs")).toBe("= 0.00  — no significant figures survive");
  });
  it("refusals are by name", () => {
    expect(ask("5 / 0 sig figs").caveats[0]).toBe("5 ÷ 0: division by zero.");
    expect(ask("3.0 m + 2.0 s sig figs").caveats[0]).toMatch(/different units/);
    expect(ask("2.5 eggs × 3.0 sig figs").caveats[0]).toMatch(/is not a count \(a count is a whole number\)/);
  });
});

describe("rounding to the uncertainty", () => {
  it("the brief's example: 10.0 ± 0.123 → 10.0 ± 0.1, the convention stated", () => {
    const r = ask("round 10.0 ± 0.123 to the uncertainty");
    expect(r.lines[0].text).toBe("10.0 ± 0.123 → 10.0 ± 0.1");
    // The two-figure rule gives 0.12, but 10.0 is known only to tenths and is never padded.
    expect(r.lines.map((l) => l.text).join("\n")).toMatch(/keep 2 significant figures → 0\.12/);
    expect(r.lines.map((l) => l.text).join("\n")).toMatch(/cannot gain a digit it was not given/);
    expect(r.caveats[0]).toBe(
      "Convention used: the uncertainty to ONE significant figure, or TWO when its leading digit is 1; the value is rounded to the same decimal place as the uncertainty.",
    );
  });
  // 0.0234 → 0.02; Decimal('9.87654').quantize(Decimal('0.01'), ROUND_HALF_UP) = 9.88
  it("9.87654 ± 0.0234 → 9.88 ± 0.02", () => expect(first("round 9.87654 ± 0.0234 to the uncertainty")).toBe("9.87654 ± 0.0234 → 9.88 ± 0.02"));
  // 0.0156 → 0.016 (leading 1: two figures); Decimal('1.2345') HALF_UP → 1.235, HALF_EVEN → 1.234
  it("1.2345 ± 0.0156 → 1.235 ± 0.016, the tie named", () => {
    expect(first("round 1.2345 ± 0.0156 to the uncertainty")).toBe("1.2345 ± 0.0156 → 1.235 ± 0.016");
    expect(all("round 1.2345 ± 0.0156 to the uncertainty")).toMatch(/round-half-to-even would give 1\.234/);
  });
  it("large values factor the power out so no zero is ambiguous", () => {
    expect(first("round 1234.5 ± 23 to the uncertainty")).toBe("1234.5 ± 23 → (1.23 ± 0.02)×10³");
  });
  it("'1 sig fig' asks for one figure even when the uncertainty starts with 1", () => {
    expect(first("10.00 ± 0.123 with 1 sig fig")).toBe("10.00 ± 0.123 → 10.0 ± 0.1");
  });
  it("refuses a value coarser than its uncertainty, and a negative uncertainty", () => {
    expect(ask("round 10 ± 0.123 to the uncertainty").caveats[0]).toMatch(/stated only to 10⁰, coarser than its uncertainty/);
    expect(ask("round 10.0 ± −0.1 to the uncertainty").caveats[0]).toMatch(/An uncertainty is a magnitude/);
  });
});

describe("exact helpers", () => {
  const q = (n: bigint, d: bigint = 1n) => ({ n, d });
  it("floorLog10 is exact at powers of ten", () => {
    expect(floorLog10(q(1000n))).toBe(3);
    expect(floorLog10(q(999n))).toBe(2);
    expect(floorLog10(q(1n, 1000n))).toBe(-3);
    expect(floorLog10(q(999n, 1000000n))).toBe(-4);
  });
  it("roundToPlace: halves away from zero, half-to-even reported", () => {
    expect(roundToPlace(q(25n, 10n), 0)).toEqual({ M: 3n, tie: true, evenM: 2n });
    expect(roundToPlace(q(-25n, 10n), 0)).toEqual({ M: -3n, tie: true, evenM: -2n });
    expect(roundToPlace(q(35n, 10n), 0)).toEqual({ M: 4n, tie: true, evenM: 4n });
  });
  it("displayRounded uses U+2212 and scientific form for placeholder zeros", () => {
    expect(displayRounded(-12n, 3).main).toBe("−1.2×10⁴");
    expect(displayRounded(120n, 0).main).toBe("1.20×10²");
    expect(displayRounded(457n, -5).main).toBe("0.00457");
  });
});

describe("display contract", () => {
  const qs = [
    "sig figs in 1200",
    "round 12345 to 2 significant figures",
    "3.40 × 2.1 with sig figs",
    "round 10.0 ± 0.123 to the uncertainty",
    "1.00 - 0.999 with sig figs",
    "round −2.5 to 1 sig fig",
  ];
  it.each(qs)("%s: no ASCII exponent, no e-notation, no hyphen-minus before a digit", (q) => {
    const t = all(q);
    expect(t).not.toMatch(/\^|\de[+-]?\d|(^|[\s(=])-\d/);
  });
});
