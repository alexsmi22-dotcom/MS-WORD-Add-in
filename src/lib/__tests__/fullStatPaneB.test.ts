/**
 * "Fully inclusive" (2026-10-28), stat pane part B: the plain-language readings of panel-fe, panel-re, panel-did,
 * boot-ci, qreg, ineq-gini, conc-hhi, io-leontief, micro-market and micro-oligopoly. Each reading keeps the rules
 * (calcReading.readingProblems), changes with the input, takes the wording branch its result calls for, and every
 * number in it is printed in the text or a table cell.
 */
import type { StatOutput } from "../analyzeBlocks";
import { readingProblems } from "../calcReading";
import { panelFeCalc, panelReCalc, panelDidCalc, PANEL_FE_DEFAULTS, PANEL_RE_DEFAULTS, PANEL_DID_DEFAULTS } from "../panelCalcs";
import { bootCiCalc, qregCalc, BOOT_CI_DEFAULTS, QREG_DEFAULTS } from "../robustCalcs";
import { ineqGiniCalc, concHhiCalc, ioLeontiefCalc, INEQ_GINI_DEFAULTS, CONC_HHI_DEFAULTS, IO_LEONTIEF_DEFAULTS } from "../econE5aCalcs";
import { microMarketCalc, microOligopolyCalc, MICRO_MARKET_DEFAULTS, MICRO_OLIGOPOLY_DEFAULTS } from "../microCalcs";

type Calc = (r: (k: string) => string) => StatOutput;

function run(calc: Calc, defaults: Record<string, string>, over: Record<string, string> = {}): StatOutput {
  return calc((k) => over[k] ?? defaults[k] ?? "");
}

/** Every number token of the reading, each found in the text or a table cell. */
function missingNumbers(o: StatOutput): string[] {
  const hay = [o.text, ...(o.tables ?? []).flatMap((t) => t.rows.flat())].join("\n");
  const toks = (o.reading ?? "").match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return toks.map((t) => t.replace(/,$/, "")).filter((t) => !hay.includes(t));
}

/** Holds a reading to the rules and to the numbers printed beside it. */
function check(o: StatOutput): string {
  expect(o.ok).not.toBe(false);
  expect(readingProblems(o.reading)).toEqual([]);
  expect(missingNumbers(o)).toEqual([]);
  // The tables' "< 0.001" carries a no-break space; compare with plain spaces.
  return o.reading!.replace(/\s/g, " ");
}

/** A deterministic uniform noise column appended to a tab-separated table with a header row. */
function addNoise(table: string, seed: number): string {
  let s = seed >>> 0;
  const u = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return table
    .split("\n")
    .map((l, i) => (i === 0 ? `${l}\tnoise` : `${l}\t${(u() * 10).toFixed(3)}`))
    .join("\n");
}

describe("panel-fe", () => {
  const D = PANEL_FE_DEFAULTS;
  test("defaults: a significant association, within the same firm", () => {
    const r = check(run(panelFeCalc, D));
    expect(r).toMatch(/^Within the same firm over time, a one-unit rise in sales goes with about 0\.133 more invest/);
    expect(r).toMatch(/unlikely to be chance/);
    expect(r).not.toMatch(/\b(causes?|effect|proves?)\b/);
  });
  test("entity and time effects say so", () => {
    expect(check(run(panelFeCalc, D, { effects: "twoway" }))).toMatch(/net of shifts common to each year/);
  });
  test("a noise regressor takes the not-significant branch", () => {
    const o = run(panelFeCalc, D, { data: addNoise(D.data, 7), spec: "invest ~ noise" });
    const r = check(o);
    const p = Number(o.tables![0].rows[1][4].replace(/[^\d.]/g, ""));
    if (p >= 0.05) expect(r).toMatch(/cannot rule out no association/);
    else expect(r).toMatch(/unlikely to be chance/);
    expect(r).not.toEqual(run(panelFeCalc, D).reading);
  });
});

describe("panel-re", () => {
  const D = PANEL_RE_DEFAULTS;
  test("defaults: the slope, then the Hausman verdict that agrees with its p", () => {
    const r = check(run(panelReCalc, D));
    expect(r).toMatch(/^Under random effects, a one-unit rise in sales goes with about 0\.167 more invest/);
    expect(r).toMatch(/Hausman test finds evidence \(p = 0\.043\)/);
  });
  test("the Hausman wording follows its p on other specifications", () => {
    const seen = new Set<string>();
    for (const spec of ["invest ~ capital", "invest ~ sales", "invest ~ capital + sales"]) {
      const o = run(panelReCalc, D, { spec });
      const r = check(o);
      const haus = o.tables!.find((t) => t.label === "Hausman test")!.rows[1];
      const p = haus[3].includes("<") ? 0 : Number(haus[3]);
      if (p < 0.05) {
        expect(r).toMatch(/finds evidence/);
        seen.add("evidence");
      } else {
        expect(r).toMatch(/finds no clear evidence/);
        seen.add("none");
      }
    }
    expect(seen.size).toBe(2);
  });
});

/** A small panel: 8 units × 6 years; units 1–2 treated from year 2, 3–4 from year 4 (staggered), 5–8 never. */
function staggeredPanel(effect: number): string {
  let s = 99;
  const g = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
  const lines = ["unit\tyear\ty\td"];
  for (let i = 1; i <= 8; i++) {
    for (let t = 0; t < 6; t++) {
      const d = (i <= 2 && t >= 2) || (i >= 3 && i <= 4 && t >= 4) ? 1 : 0;
      lines.push([`U${i}`, 2000 + t, (10 + i + 0.5 * t + effect * d + g()).toFixed(3), d].join("\t"));
    }
  }
  return lines.join("\n");
}

describe("panel-did", () => {
  const D = PANEL_DID_DEFAULTS;
  test("defaults: an estimated effect with its interval, hedged on parallel trends", () => {
    const r = check(run(panelDidCalc, D));
    expect(r).toBe(
      "The estimated effect of “policy” on employment is about 2.715 (95% CI 2.114 to 3.316, p < 0.001), a change unlikely to be chance if treated and comparison units would otherwise have moved in parallel.",
    );
  });
  test("an outcome the policy does not move takes the cannot-rule-out branch", () => {
    const o = run(panelDidCalc, D, { outcome: "population" });
    const r = check(o);
    const p = o.tables![0].rows[1][4];
    if (!p.includes("<") && Number(p) >= 0.05) expect(r).toMatch(/cannot rule out no effect/);
  });
  test("staggered adoption adds the caution", () => {
    const base = { data: staggeredPanel(3), outcome: "y", entity: "unit", time: "year", treat: "d", leads: "2", lags: "2" };
    const r = check(run(panelDidCalc, D, base));
    expect(r).toMatch(/Treatment starts at different times/);
    const r0 = check(run(panelDidCalc, D, { ...base, data: staggeredPanel(0) }));
    expect(r0).toMatch(/cannot rule out no effect/);
  });
});

describe("boot-ci", () => {
  const D = BOOT_CI_DEFAULTS;
  test("defaults: the median and its BCa interval", () => {
    expect(check(run(bootCiCalc, D))).toBe("The median of spend is about 2,359 in these 40 rows, and the 95% BCa bootstrap interval puts it between 2,216 and 2,633.");
  });
  test("other statistics and methods change the sentence", () => {
    const r = check(run(bootCiCalc, D, { stat: "mean", method: "percentile", conf: "90" }));
    expect(r).toMatch(/^The mean of spend is about .* 90% Percentile bootstrap interval/);
  });
  test("a correlation says whether 0 is inside the interval", () => {
    const o = run(bootCiCalc, D, { stat: "corr", vars: "spend ~ income" });
    expect(check(o)).toMatch(/excludes 0, so the data point to a positive correlation/);
    const noisy = run(bootCiCalc, D, { data: addNoise(D.data, 3), stat: "corr", vars: "spend ~ noise" });
    const r = check(noisy);
    const iv = /BCa interval: \[(.*); (.*)\]/.exec(noisy.text)!;
    const lo = Number(iv[1].replace("−", "-").replace(/,/g, ""));
    const hi = Number(iv[2].replace("−", "-").replace(/,/g, ""));
    expect(r).toMatch(lo > 0 || hi < 0 ? /excludes 0/ : /includes 0, so the data are consistent with no correlation/);
  });
});

describe("qreg", () => {
  const D = QREG_DEFAULTS;
  test("defaults: the median slope, then the spread across quantiles", () => {
    expect(check(run(qregCalc, D))).toBe(
      "At the median (τ = 0.5), a one-unit rise in educ goes with about 1.059 more wage (p < 0.001), an association unlikely to be chance. The estimate is 0.847 at τ = 0.25 and 1.369 at τ = 0.75, so the point estimate is higher toward the top of the distribution.",
    );
  });
  test("one quantile, not the median: one sentence", () => {
    const r = check(run(qregCalc, D, { quantiles: "0.9" }));
    expect(r).toMatch(/^At quantile τ = 0\.9, a one-unit rise in educ/);
    expect(r).not.toMatch(/The estimate is/);
  });
  test("a noise predictor follows its p", () => {
    const o = run(qregCalc, D, { data: addNoise(D.data, 11), spec: "wage ~ noise" });
    const r = check(o);
    const mid = o.tables!.find((t) => t.label.endsWith("τ = 0.5"))!.rows[1][4];
    expect(r).toMatch(!mid.includes("<") && Number(mid) >= 0.05 ? /cannot rule out/ : /unlikely to be chance/);
  });
});

describe("ineq-gini", () => {
  const D = INEQ_GINI_DEFAULTS;
  test("defaults: the Gini on its scale and the top 10% against the bottom 40%", () => {
    expect(check(run(ineqGiniCalc, D))).toBe(
      "The Gini coefficient is 0.3913 on a scale from 0 (everyone has the same income) to 1 (one person has it all). The richest 10% receive 29.61% of all income, more than the 16.69% that goes to the poorest 40%.",
    );
  });
  test("equal incomes: no inequality", () => {
    expect(check(run(ineqGiniCalc, D, { data: "Income\n500\n500\n500" }))).toMatch(/^Every income is the same, so the Gini coefficient is 0\.0000/);
  });
  test("grouped data: a lower bound", () => {
    const r = check(run(ineqGiniCalc, D, { layout: "grouped", data: "Income\tCount\n10000\t40\n30000\t40\n90000\t20" }));
    expect(r).toMatch(/^The Gini coefficient is at least /);
  });
  test("a flat distribution: the top 10% get less than the bottom 40%", () => {
    expect(check(run(ineqGiniCalc, D, { data: "Income\n10\n11\n12\n13\n14\n15\n16\n17\n18\n19" }))).toMatch(/less than the/);
  });
});

describe("conc-hhi", () => {
  const D = CONC_HHI_DEFAULTS;
  test("defaults: the merger meets the presumption, said as a rebuttable screen", () => {
    expect(check(run(concHhiCalc, D))).toBe(
      "The merger of Cedar and Elm raises the HHI by 360 to 2,312, with a combined share of 28%, so it meets the 2023 Merger Guidelines' structural presumption against the merger. That presumption is a screen the parties can rebut, not a legal conclusion.",
    );
  });
  const small = ["Firm\tShare", "A\t20", "B\t20", "C\t20", "D\t20", "E\t10", "F\t5", "G\t5"].join("\n");
  test("a small merger: no presumption", () => {
    expect(check(run(concHhiCalc, D, { data: small, merging: "F\nG" }))).toMatch(/raises the HHI by 50 to 1,800, .*does not meet either structural presumption/);
  });
  test("no merger: the market level against 1,800", () => {
    expect(check(run(concHhiCalc, D, { merging: "" }))).toBe(
      "The market's HHI is 1,952, above the 1,800 that the 2023 Merger Guidelines treat as highly concentrated; the four largest firms hold 82% of the market.",
    );
    expect(check(run(concHhiCalc, D, { data: small, merging: "" }))).toMatch(/HHI is 1,750, not above the 1,800/);
  });
  test("an unnamed fringe that straddles 1,800: depends on the split", () => {
    expect(check(run(concHhiCalc, D, { data: "Firm\tShare\nA\t30\nB\t10", merging: "" }))).toMatch(/depends on how the unnamed fringe splits/);
  });
});

describe("io-leontief", () => {
  const D = IO_LEONTIEF_DEFAULTS;
  test("defaults: the largest multiplier, and no key sector", () => {
    expect(check(run(ioLeontiefCalc, D))).toBe(
      "Under the model's fixed input shares, each extra unit of final demand for Farming raises output across all 3 sectors by 2.4623 units, the largest output multiplier. No sector is a key sector, strongly linked both to its suppliers and to its buyers.",
    );
  });
  test("a hub sector is named as a key sector", () => {
    const m = ["Sector\tHub\tB\tC", "Hub\t0.3\t0.3\t0.3", "B\t0.1\t0.05\t0.05", "C\t0.1\t0.05\t0.05"].join("\n");
    const r = check(run(ioLeontiefCalc, D, { matrix: m }));
    expect(r).toMatch(/for Hub raises output/);
    expect(r).toMatch(/Hub is a key sector,/);
  });
  test("tied multipliers are named together", () => {
    const m = ["Sector\tA\tB", "A\t0.1\t0.1", "B\t0.1\t0.1"].join("\n");
    expect(check(run(ioLeontiefCalc, D, { matrix: m, fd: "1, 1", emp: "" }))).toMatch(/for A and B \(tied\)/);
  });
});

describe("micro-market", () => {
  const D = MICRO_MARKET_DEFAULTS;
  test("defaults: the tax's incidence and deadweight loss", () => {
    expect(check(run(microMarketCalc, D))).toBe(
      "Under the model's straight-line demand and supply, the tax of 10 raises the buyers' price from 80 to 84 and cuts the sellers' price to 74, so buyers bear 40% of it and sellers 60%. Trade falls from 20 to 18, and the deadweight loss is 10 ($).",
    );
  });
  test("each policy has its own sentence", () => {
    expect(check(run(microMarketCalc, D, { policy: "none" }))).toMatch(/clears at a quantity of 20 and a price of 80/);
    expect(check(run(microMarketCalc, D, { policy: "subsidy" }))).toMatch(/subsidy of 10 lowers the buyers' price from 80 to 76 .* Trade rises from 20 to 22/);
    expect(check(run(microMarketCalc, D, { policy: "ceiling", amount: "70" }))).toMatch(/price ceiling of 70 binds: buyers want 25 but sellers supply only about 16\.667, a shortage of about 8\.333/);
    expect(check(run(microMarketCalc, D, { policy: "ceiling", amount: "90" }))).toMatch(/does not bind, because it is at or above the market price of 80/);
    expect(check(run(microMarketCalc, D, { policy: "floor", amount: "90" }))).toMatch(/price floor of 90 binds: sellers offer about 23\.333 but buyers take only 15/);
    expect(check(run(microMarketCalc, D, { policy: "ceiling", amount: "10" }))).toMatch(/closes the market: nothing is traded/);
  });
  test("a subsidy that opens a closed market", () => {
    expect(check(run(microMarketCalc, D, { a: "20", c: "30", policy: "subsidy", amount: "20" }))).toMatch(/^Without the subsidy nothing is traded; the subsidy of 20 opens the market/);
  });
});

describe("micro-oligopoly", () => {
  const D = MICRO_OLIGOPOLY_DEFAULTS;
  test("defaults: the Cournot price between competition and monopoly", () => {
    expect(check(run(microOligopolyCalc, D))).toBe(
      "Under the model's assumptions, Cournot competition among the 2 firms sets the price at 50, between the competitive 10 and the monopoly 65. It loses 1,100 of surplus, against 1,512.5 under monopoly ($).",
    );
  });
  test("one firm: the monopoly", () => {
    expect(check(run(microOligopolyCalc, D, { costs: "Solo\t10" }))).toMatch(/^Under the model's assumptions, a single firm sets the monopoly price of 65 against 10/);
  });
  test("a high-cost rival exits: Cournot is the monopoly price", () => {
    expect(check(run(microOligopolyCalc, D, { costs: "Low\t10\nHigh\t100" }))).toMatch(/sets the price at 65, the same as the monopoly price/);
  });
  test("three firms", () => {
    expect(check(run(microOligopolyCalc, D, { costs: "A\t10\nB\t10\nC\t10" }))).toMatch(/among the 3 firms sets the price at 37\.5/);
  });
});
