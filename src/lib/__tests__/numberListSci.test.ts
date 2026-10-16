// Scientific notation AS THE PRODUCT DISPLAYS IT must read back (the display
// contract). Defect found during the axis migration: readNumberList dropped
// "1.5×10⁻⁵" (parseCellNumber returned NaN), and the SPACED form "1.5 × 10⁻⁵"
// was worse — split into three tokens, the list silently held 1.5.

import { readNumberList, decimalCommaNote } from "../numberList";
import { parseCellNumber } from "../dataimport";
import { fmtValue, MINUS } from "../axis";

const close = (a: number[], b: number[]): void => {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 15));
};

describe("readNumberList reads ×10ⁿ", () => {
  test("unspaced superscript form", () => {
    const r = readNumberList("1.5×10⁻⁵ 2.5×10⁻⁵ 3×10⁻⁵");
    close(r.values, [1.5e-5, 2.5e-5, 3e-5]);
    expect(r.dropped).toEqual([]);
  });

  test("the spaced form is ONE number, not 1.5 plus two dropped tokens", () => {
    const r = readNumberList("1.5 × 10⁻⁵, 2 × 10⁶");
    close(r.values, [1.5e-5, 2e6]);
    expect(r.dropped).toEqual([]);
  });

  test("caret forms, x and ·", () => {
    close(readNumberList("3x10^-4 5X10^2 7·10^3 1.5 x 10 ^ -2").values, [3e-4, 500, 7000, 0.015]);
  });

  test("U+2212 on the mantissa and on the exponent", () => {
    close(readNumberList(`${MINUS}1.5×10⁻⁵ 2×10^${MINUS}3`).values, [-1.5e-5, 2e-3]);
  });

  test("a decimal-comma mantissa, and the note says so", () => {
    const r = readNumberList("1,5×10⁻⁵ 2,5×10⁻⁵");
    close(r.values, [1.5e-5, 2.5e-5]);
    expect(r.decimalCommas).toBe(2);
    expect(decimalCommaNote(r)).toContain("1,5×10⁻⁵ → 1.5×10⁻⁵");
    expect(decimalCommaNote(r)).not.toMatch(/\de-\d/);
  });

  test("a decimal-comma field rereads a three-digit MANTISSA too: 1,250×10³ is 1.25×10³, not 1.25×10⁶", () => {
    const r = readNumberList("2,5×10³ 1,250×10³");
    close(r.values, [2500, 1250]);
    expect(r.reread).toEqual(["1,250×10³"]);
  });

  test("a product is not joined: 2 × 3 and 2 x 10 stay separate", () => {
    const a = readNumberList("2 × 3");
    expect(a.values).toEqual([2, 3]);
    expect(a.dropped).toEqual(["×"]);
    const b = readNumberList("2 x 10");
    expect(b.values).toEqual([2, 10]);
  });

  test("what fmtValue prints reads back", () => {
    for (const v of [1.5e-5, -2.25e-7, 3.5e9, 1.23e12, -0.000123]) {
      const shown = fmtValue(v);
      const back = readNumberList(`${shown} 1`).values[0];
      expect(back).toBeCloseTo(v, 12 - Math.floor(Math.log10(Math.abs(v))));
    }
  });
});

describe("parseCellNumber: the table feed reads the same notation", () => {
  test.each([
    ["1.5×10⁻⁵", 1.5e-5],
    ["2.5 × 10⁶", 2.5e6],
    ["−4×10³", -4000],
    ["1,5×10⁻²", 0.015],
  ])("%s", (s, v) => expect(parseCellNumber(s)).toBeCloseTo(v, 15));

  test.each(["×10⁵", "2×10", "abc×10⁵", "1.5×10⁻", "1.5×10^"])("not a number: %s", (s) => {
    expect(Number.isNaN(parseCellNumber(s))).toBe(true);
  });
});
