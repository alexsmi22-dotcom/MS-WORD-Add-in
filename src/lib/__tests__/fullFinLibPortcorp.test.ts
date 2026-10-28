/**
 * "Fully inclusive" (2026-10-28): the plain-language readings of the portfolio and corporate-finance calculators
 * (portcorpCalcs.ts). Every reading keeps the rules (lib/calcReading.ts), its numbers appear in the text or tables as
 * printed, it changes with the input, and each wording branch is reached.
 */
import { PORTCORP_CALCS } from "../portcorpCalcs";
import { calcById, checkedReading } from "./fullFinLibHelpers";

const calc = (id: string) => calcById(PORTCORP_CALCS, id);
const read = (id: string, over: Record<string, string> = {}): string => checkedReading(calc(id), over);

/** Two columns (asset, market) from a market series and a rule for the asset. */
const pairs = (m: number[], f: (x: number, i: number) => number): string => m.map((x, i) => `${f(x, i).toFixed(2)}\t${x}`).join("\n");
const M = [1, -2, 3, -1, 2, 0, -3, 4, 1, -2, 2.5, -1.5];
const wiggle = (i: number): number => (i % 2 ? 0.1 : -0.1);

describe("every portcorp calculator: defaults carry a checked reading that changes with the input", () => {
  const changes: [string, Record<string, string>][] = [
    ["port-capm", { rf: "1" }],
    ["port-performance", { rf: "1" }],
    ["port-var", { conf: "99" }],
    ["port-frontier", { rf: "1" }],
    ["corp-wacc", { beta: "1.5" }],
    ["corp-capbudget", { rate: "12" }],
    ["corp-dcf", { wacc: "10" }],
  ];
  test.each(changes)("%s", (id, over) => {
    const a = read(id);
    const b = read(id, over);
    expect(b).not.toBe(a);
  });
  test("all seven are covered", () => {
    expect(PORTCORP_CALCS.map((c) => c.id).sort()).toEqual(changes.map(([id]) => id).sort());
  });
});

describe("port-capm", () => {
  test("defaults: beta above 1 with an interval above 1, alpha not distinguishable from zero", () => {
    const r = read("port-capm");
    expect(r).toMatch(/^Fund has a beta of about 1\.2643 against Market/);
    expect(r).toContain("swings more than the market");
    expect(r).toContain("no clear evidence of a nonzero alpha");
    expect(r).not.toMatch(/\bnull\b/);
  });
  test("a significant positive alpha (asset = 0.5 × market + 2% each period)", () => {
    const r = read("port-capm", { data: pairs(M, (x, i) => 0.5 * x + 2 + wiggle(i)) });
    expect(r).toMatch(/^The asset has a beta/);
    expect(r).toContain("swings less than the market");
    expect(r).toContain("a return beyond what that market risk explains, unlikely to be chance");
  });
  test("a significant negative alpha, a negative beta", () => {
    const r = read("port-capm", { data: pairs(M, (x, i) => -0.8 * x - 2 + wiggle(i)) });
    expect(r).toContain("tends to move against the market");
    expect(r).toContain("a shortfall against what that market risk explains");
  });
  test("an interval spanning 1 reads as in line; one spanning 0 as no clear link", () => {
    expect(read("port-capm", { data: pairs(M, (x, i) => x + (i % 3) * 1.5 - 1.5) })).toContain("roughly in line with the market");
    expect(read("port-capm", { data: pairs(M, (_x, i) => [2, -3, 1, 4, -2, 0, 3, -1, -4, 2, 1, -2][i]) })).toContain("no clear link to the market's moves");
  });
});

describe("port-performance", () => {
  test("defaults: positive Sharpe, a recovered drawdown", () => {
    const r = read("port-performance");
    expect(r).toContain("is positive: on average it beat the risk-free rate");
    expect(r).toContain("later recovered");
  });
  test("negative Sharpe, an unrecovered drawdown", () => {
    const r = read("port-performance", { rets: "-1, -2, -0.5, -3" });
    expect(r).toContain("is negative: on average it trailed the risk-free rate");
    expect(r).toContain("not recovered by the last period");
  });
  test("no drawdown; a constant series has no Sharpe ratio", () => {
    expect(read("port-performance", { rets: "1, 2, 3, 4" })).toContain("It never fell below an earlier peak.");
    expect(read("port-performance", { rets: "1, 1, 1" })).toContain("Sharpe ratio is not defined");
  });
  test("a Sharpe ratio that prints as zero says no better than the risk-free rate", () => {
    expect(read("port-performance", { rets: "1, -1, 1, -1", rf: "0" })).toContain("did no better than the risk-free rate");
  });
});

describe("port-var", () => {
  test("defaults: a loss threshold, its frequency and the average beyond it", () => {
    const r = read("port-var");
    expect(r).toContain("a loss over one period should exceed 3.522% (35,220.00) of the 1,000,000.00 portfolio only about 5.00% of the time");
    expect(r).toContain("the loss averages about 5.220% (52,200.00)");
  });
  test("a horizon and a higher confidence", () => {
    expect(read("port-var", { conf: "99", horizon: "10" })).toContain("over 10 periods");
  });
  test("an all-gain series shows no loss at that confidence", () => {
    expect(read("port-var", { rets: "1, 2, 3, 4, 5, 6" })).toContain("so these data show no loss at that confidence");
  });
  test("a scaled VaR above 100% is named as an artifact, not a loss", () => {
    expect(read("port-var", { rets: "-50, -60, -40, -55", horizon: "50" })).toContain("an artifact of the time scaling");
  });
});

describe("port-frontier", () => {
  test("defaults name the tangency and minimum-variance weights", () => {
    const r = read("port-frontier");
    expect(r).toContain("(Sharpe ratio 0.5076) is Stocks 74.45%, Bonds 25.55%");
    expect(r).toContain("The lowest-risk mix is Stocks 4.60%, Bonds 85.97%, Gold 9.43%");
  });
  test("many assets with long names fall back to a sentence that fits", () => {
    const names = Array.from({ length: 8 }, (_, j) => `AVeryLongAssetNameNumber${j}`);
    const rows = Array.from({ length: 30 }, (_, i) => names.map((_n, j) => (Math.sin(i * (j + 1.3)) * 3 + 0.2 * j).toFixed(2)).join("\t"));
    const r = read("port-frontier", { data: [names.join("\t"), ...rows].join("\n") });
    expect(r.length).toBeLessThanOrEqual(320);
  });
});

describe("corp-wacc", () => {
  test("defaults; no debt", () => {
    expect(read("corp-wacc")).toMatch(/^The weighted average cost of capital is 8\.8125% \(equity at 10\.2500%, debt at 4\.5000% after tax\)/);
    expect(read("corp-wacc", { d: "0" })).toMatch(/^With no debt, the cost of capital is the cost of equity, 10\.2500%/);
  });
});

describe("corp-capbudget", () => {
  test("defaults: A adds more value, the ranking flips at the crossover", () => {
    const r = read("corp-capbudget");
    expect(r).toBe("At 10.000%, project A's NPV is 115.57 and project B's is 94.60, so A adds more value. The ranking flips at a discount rate of about 13.7158%.");
  });
  test("one project: adds value, loses value, breaks even", () => {
    expect(read("corp-capbudget", { cfb: "" })).toContain("it adds value at that rate; its IRR of 15.3221%");
    expect(read("corp-capbudget", { cfb: "", cfa: "-1000, 100, 100" })).toContain("it loses value at that rate");
    expect(read("corp-capbudget", { cfb: "", cfa: "-1000, 1100" })).toContain("it breaks even at that rate");
  });
  test("two IRRs: no single break-even rate claimed", () => {
    expect(read("corp-capbudget", { cfb: "", cfa: "-100, 230, -132" })).not.toContain("IRR");
  });
  test("two projects: neither, only one, identical, B ahead", () => {
    const n = read("corp-capbudget", { cfa: "-1000, 100", cfb: "-1000, 50" });
    expect(n).toContain("neither adds value, though A loses less");
    expect(n).toContain("The ranking holds at every discount rate searched.");
    expect(read("corp-capbudget", { cfa: "-1000, 1210", cfb: "-1000, 0, 1210" })).toContain("only A adds value");
    expect(read("corp-capbudget", { cfb: "-1000, 300, 400, 500, 200" })).toContain("they tie at every rate");
    expect(read("corp-capbudget", { rate: "14" })).toContain("so B adds more value");
  });
});

describe("corp-dcf", () => {
  test("defaults: equity, per share, terminal value dominates", () => {
    const r = read("corp-dcf");
    expect(r).toContain("The DCF puts the equity at about 1,674.80, or 33.4960 a share, from an enterprise value of 1,974.80.");
    expect(r).toContain("57.0% of the enterprise value is the terminal value, so the answer rests mainly on the long-run growth and discount rates.");
  });
  test("exit multiple under half; no shares; negative equity", () => {
    expect(read("corp-dcf", { terminal: "exit" })).toContain("the rest comes from the forecast years");
    expect(read("corp-dcf", { shares: "" })).not.toContain("a share");
    expect(read("corp-dcf", { netdebt: "100,000" })).toContain("so the equity value on these inputs is negative (−98,025.20)");
  });
});
