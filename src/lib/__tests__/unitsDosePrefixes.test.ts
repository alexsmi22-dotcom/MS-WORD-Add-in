// SI-prefixed gray and sievert (review pin), and the conventional mmHg.
// 1 mmHg = 13.5951 g/cm³ × 9.80665 m/s² × 1 mm = 133.322387415 Pa (Python:
// 13595.1*9.80665*0.001); BIPM SI Brochure for the prefixes.

import { convert, parseCompoundUnit } from "../units";
import { PA_PER_MMHG } from "../biomed";

const near = (a: number | null, b: number) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b)).toBeLessThanOrEqual(1e-12 * Math.abs(b));
};

describe("prefixed dose units", () => {
  it.each([
    ["kGy", "Gy", 1e3],
    ["MGy", "Gy", 1e6],
    ["nGy", "Gy", 1e-9],
    ["mGy", "Gy", 1e-3],
    ["kSv", "Sv", 1e3],
    ["nSv", "Sv", 1e-9],
    ["nSv", "µSv", 1e-3],
  ] as const)("1 %s = … %s", (from, to, f) => near(convert(1, from, to), f));
  it("MGy and mGy never collide; gray and sievert stay apart", () => {
    near(convert(1, "MGy", "mGy"), 1e9);
    expect(convert(1, "kGy", "kSv")).toBeNull();
    expect(parseCompoundUnit("nGy/h")).not.toBeNull();
  });
});

describe("mmHg", () => {
  it("biomed uses the conventional 133.322387415 Pa", () => {
    expect(PA_PER_MMHG).toBe(133.322387415);
    near(convert(1, "mmHg", "Pa"), PA_PER_MMHG);
  });
});
