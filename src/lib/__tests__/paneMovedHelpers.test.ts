// Helpers that moved out of taskpane.ts in v2.144.0 (docs/SCOPE-HOST-ADAPTER.md
// §E): finance formatters + figures, assay formatters + the proportional-law
// figure. Inside the pane they could only be pinned by reading source text;
// here they are CALLED. Every expectation below is the behaviour they had in
// the pane — the move changed no body.
import { finMoney, finPct, finFixed, moneyOverTimeSvg, cashFlowLadderSvg, bondPriceCurveSvg, optionCurveSvg } from "../financeFigures";
import { assaySig, assayValSE, assayPairXY, assayLineSvg } from "../assayFormat";
import { bondPrice } from "../finance";

const EM = String.fromCharCode(0x2014);

describe("finance formatters never print NaN or Infinity", () => {
  it.each([NaN, Infinity, -Infinity])("%p → the em-dash sentinel the insert gate blocks on", (x) => {
    expect(finMoney(x)).toBe(EM);
    expect(finPct(x)).toBe(EM);
    expect(finFixed(x, 3)).toBe(EM);
  });
  it("finite values format as before", () => {
    expect(finMoney(1647.0095)).toBe("1,647.01");
    expect(finMoney(-0.004)).toBe("-0.00");
    expect(finPct(0.0525)).toBe("5.25%");
    expect(finFixed(Math.PI, 4)).toBe("3.1416");
  });
});

describe("finance figures", () => {
  it("money over time: an svg for a finite curve, nothing for one that never produces a finite point", () => {
    const svg = moneyOverTimeSvg({ periods: 10, valueAt: (k) => 1000 * Math.pow(1.05, k), title: "t", xlabel: "x", ylabel: "y" });
    expect(svg).toMatch(/^<svg/);
    expect(moneyOverTimeSvg({ periods: 10, valueAt: () => NaN, title: "t", xlabel: "x", ylabel: "y" })).toBeUndefined();
  });
  it("a user period count of 1e9 still returns (the count is clamped, not looped)", () => {
    const t0 = Date.now();
    moneyOverTimeSvg({ periods: 1e9, valueAt: (k) => k, title: "t", xlabel: "x", ylabel: "y" });
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it("cash-flow ladder and the bond and option curves draw from finite inputs", () => {
    const flows = [-1000, 300, 400, 500];
    const disc = flows.map((c, k) => c / Math.pow(1.08, k));
    expect(cashFlowLadderSvg(flows, disc, "NPV")).toMatch(/^<svg/);
    expect(cashFlowLadderSvg(flows, [1, 2], "NPV")).toBeUndefined();
    const price = bondPrice(1000, 0.05, 0.06, 10, 2);
    expect(bondPriceCurveSvg({ face: 1000, coupon: 0.05, ytm: 0.06, years: 10, freq: 2, price })).toMatch(/^<svg/);
    expect(optionCurveSvg({ type: "call", s: 100, k: 100, t: 1, r: 0.05, sig: 0.2, price: 10.45 })).toMatch(/^<svg/);
    expect(optionCurveSvg({ type: "call", s: 100, k: 0, t: 1, r: 0.05, sig: 0.2, price: 10.45 })).toBeUndefined();
  });
});

describe("assay formatters", () => {
  it("significant figures without trailing-zero noise; the sentinel for non-finite", () => {
    expect(assaySig(0.000123456)).toBe("0.0001235");
    expect(assaySig(1200000, 2)).toBe("1200000");
    expect(assaySig(0)).toBe("0");
    expect(assaySig(NaN)).toBe(EM);
  });
  it("value ± SE drops the ± part when the SE is unavailable", () => {
    expect(assayValSE(1.23456, 0.0123)).toBe("1.235 ± 0.012");
    expect(assayValSE(1.23456, NaN)).toBe("1.235");
  });
  it("pairs equal-length lists, refuses unequal or too-short ones", () => {
    expect(assayPairXY([1, 2, 3], [4, 5, 6], 3)).toEqual([{ x: 1, y: 4 }, { x: 2, y: 5 }, { x: 3, y: 6 }]);
    expect(assayPairXY([1, 2], [4, 5, 6], 2)).toBeNull();
    expect(assayPairXY([1], [4], 2)).toBeNull();
  });
  it("the proportional law draws, and draws NOTHING for a non-finite slope or point", () => {
    expect(assayLineSvg({ slope: 2, x: 0.5, y: 1, xlabel: "c", ylabel: "A", title: "t" })).toMatch(/^<svg/);
    expect(assayLineSvg({ slope: NaN, x: 0.5, y: 1, xlabel: "c", ylabel: "A", title: "t" })).toBeUndefined();
    expect(assayLineSvg({ slope: 2, x: Infinity, y: 1, xlabel: "c", ylabel: "A", title: "t" })).toBeUndefined();
  });
});
