/**
 * The label-content gate (scripts/figure-label-audit.js, v2.143.0) reports itself
 * first: each predicate must fire on a known-bad SVG and stay silent on a
 * known-good one. This runs that self-test under jest too, so a change that
 * blinds a predicate fails the unit suite, not only the QC gate.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const audit = require("../../../scripts/figure-label-audit.js");

describe("figure-label-audit self-test", () => {
  test("every predicate fires on its known-bad payload and none fires on the known-good one", () => {
    expect(audit.selfTest()).toEqual([]);
  });
  test("B.1's repro (identical tick labels) and B.2/B.3/B.4 are each caught", () => {
    const row = (labels: string[]): string =>
      `<svg width="400" height="300">${labels.map((l, i) => `<text x="${50 + i * 40}" y="200" text-anchor="middle">${l}</text>`).join("")}</svg>`;
    expect(audit.auditLabels(row(["2.0e+4", "2.0e+4", "2.0e+4"])).DUPLICATE.length).toBe(1);
    expect(audit.auditLabels(row(["2.0e+4", "2.0e+4", "2.0e+4"])).ENOTATION.length).toBe(3);
    expect(audit.auditLabels(row(["-2.5", "0", "2.5"])).HYPHEN).toEqual(["-2.5"]);
    expect(audit.auditLabels(row(["0", "200.0", "400.0", "600.0"])).DECIMALS.length).toBe(1);
    // U+2212 and constant decimals: clean.
    const clean = audit.auditLabels(row([String.fromCharCode(0x2212) + "2.5", "0.0", "2.5"]));
    expect([clean.HYPHEN, clean.DECIMALS, clean.DUPLICATE, clean.ENOTATION]).toEqual([[], [], [], []]);
  });
});
