// A logarithmic axis must label its decades in ONE notation.
//
// fmtTick switches to exponential at |v| >= 1e4, and fmtLogTick used to
// delegate to it through e = 4. A Bode plot swept 1 Hz to 100 kHz therefore
// read "100, 1000, 1.0e+4, 10^5" — plain, plain, exponential, superscript, with
// the odd one in the middle. Nothing was numerically wrong, which is why it
// survived: it is a figure-quality defect, and figures are the output.

import { fmtLogTick } from "../plot";

const DECADES = [1e-4, 1e-3, 0.01, 0.1, 1, 10, 100, 1000, 1e4, 1e5, 1e6];

describe("one notation per axis", () => {
  test("no decade label uses the e+N form", () => {
    for (const v of DECADES) {
      expect({ v, label: fmtLogTick(v) }).toEqual({ v, label: expect.not.stringContaining("e+") });
    }
  });

  test("no decade label uses a lowercase e exponent at all", () => {
    for (const v of DECADES) expect(fmtLogTick(v)).not.toMatch(/\d[eE][+-]?\d/);
  });

  test("the plain band is contiguous and the superscript band takes over cleanly", () => {
    expect(fmtLogTick(0.001)).toBe("0.001");
    expect(fmtLogTick(1)).toBe("1");
    expect(fmtLogTick(1000)).toBe("1000");
    // The first decade past the plain band, which is the one that was wrong.
    expect(fmtLogTick(1e4)).toBe("10⁴");
    expect(fmtLogTick(1e5)).toBe("10⁵");
    expect(fmtLogTick(1e-4)).toBe("10⁻⁴");
  });

  test("labels are distinct, so two decades never render the same", () => {
    const labels = DECADES.map(fmtLogTick);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("the notation changes exactly once going up the axis", () => {
    // Classify each label as plain or superscript; the sequence must be a single
    // run of one followed by a single run of the other on each side of 1.
    const kinds = [1, 10, 100, 1000, 1e4, 1e5, 1e6].map((v) =>
      /[⁰-⁹⁻]/.test(fmtLogTick(v)) ? "sup" : "plain",
    );
    const changes = kinds.filter((k, i) => i > 0 && k !== kinds[i - 1]).length;
    expect({ kinds, changes }).toEqual({ kinds, changes: 1 });
  });
});
