// A logarithmic axis must label its decades in ONE notation.
//
// fmtTick switches to exponential at |v| >= 1e4, and fmtLogTick used to
// delegate to it through e = 4. A Bode plot swept 1 Hz to 100 kHz therefore
// read "100, 1000, 1.0e+4, 10^5" — plain, plain, exponential, superscript, with
// the odd one in the middle. Nothing was numerically wrong, which is why it
// survived: it is a figure-quality defect, and figures are the output.
//
// v2.143.0: plot.fmtLogTick (a per-value labeller) was dead after the axis-engine
// migration and was removed. Log axes are now labelled as a ROW by axis.logAxis,
// which goes further than "one change of notation": across three decades or more
// every label is 10ⁿ (journal style, brief B.7). These tests pin that row.

import { logAxis } from "../axis";

/** Labels of a log axis over [10^lo, 10^hi]. */
const row = (lo: number, hi: number): string[] => logAxis(lo, hi).labelled.map((l) => l.text);

describe("one notation per axis", () => {
  test("no decade label uses an e exponent, on any span from 10⁻⁴ to 10⁶", () => {
    for (let lo = -4; lo < 6; lo++) {
      for (let hi = lo + 1; hi <= 6; hi++) {
        for (const t of row(lo, hi)) expect({ lo, hi, t, e: /\d[eE][+-]?\d/.test(t) }).toEqual({ lo, hi, t, e: false });
      }
    }
  });

  test("the Bode sweep 1 Hz to 100 kHz reads 10⁰ … 10⁵, uniformly", () => {
    expect(row(0, 5)).toEqual(["10⁰", "10¹", "10²", "10³", "10⁴", "10⁵"]);
  });

  test("under three decades the plain band stays plain", () => {
    expect(row(-3, -1)).toEqual(["0.001", "0.01", "0.1"]);
    expect(row(0, 2)).toEqual(["1", "10", "100"]);
  });

  test("labels are distinct, so two decades never render the same", () => {
    const labels = row(-4, 6);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("the notation never changes along an axis of three decades or more", () => {
    for (const [lo, hi] of [[-4, 6], [0, 3], [-2, 4]]) {
      const kinds = new Set(row(lo, hi).map((t) => (/^10[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+$/.test(t) ? "sup" : "plain")));
      expect({ lo, hi, kinds: [...kinds] }).toEqual({ lo, hi, kinds: ["sup"] });
    }
  });
});
