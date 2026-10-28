/**
 * "Fully inclusive" (2026-10-28), stat pane part A: the plain-language readings of ts-arima, ts-ets, es-event,
 * idx-price, idx-deflate, rmanova, cox, welchanova and gameshowell. Each reading keeps the rules (readingProblems),
 * changes with the input, takes the wording branch the result calls for, and every number in it is printed in the
 * text or a table cell.
 */
import type { StatOutput } from "../analyzeBlocks";
import { readingProblems } from "../calcReading";
import { tsArimaCalc, tsEtsCalc, TS_ARIMA_DEFAULTS, TS_ETS_DEFAULTS } from "../tsForecastCalcs";
import { esEventCalc, idxPriceCalc, idxDeflateCalc, ES_EVENT_DEFAULTS, IDX_PRICE_DEFAULTS, IDX_DEFLATE_DEFAULTS } from "../econE3Calcs";
import { rmAnovaCalc, coxCalc } from "../statsBatchCalcs";
import { welchAnovaCalc, gamesHowellCalc } from "../welchCalcs";

type Out = { text: string; reading?: string; ok?: boolean; tables?: StatOutput["tables"] };

const reader = (defaults: Record<string, string>, over: Record<string, string> = {}) => (k: string): string =>
  over[k] ?? defaults[k] ?? "";

/** The pane defaults (taskpane.ts STAT_CALCS) of the calculators whose fields live there. */
const WELCH_DEFAULT = "63 57 52 41 43\n\n32 39 51 30 35\n\n62 60 71 55 48\n\n42 50 41 37";
const RM_DEFAULT =
  "Stick_insect Kangaroo_testicle Fish_eye Witchetty_grub\n8 7 1 6\n9 5 2 5\n6 2 3 8\n5 3 1 9\n8 4 5 8\n7 5 6 7\n10 2 7 2\n12 6 8 1";
const COX_DEFAULT =
  "time status placebo\n6 1 0\n6 1 0\n6 1 0\n6 0 0\n7 1 0\n9 0 0\n10 1 0\n10 0 0\n11 0 0\n13 1 0\n16 1 0\n17 0 0\n19 0 0\n20 0 0\n22 1 0\n23 1 0\n25 0 0\n32 0 0\n32 0 0\n34 0 0\n35 0 0\n1 1 1\n1 1 1\n2 1 1\n2 1 1\n3 1 1\n4 1 1\n4 1 1\n5 1 1\n5 1 1\n8 1 1\n8 1 1\n8 1 1\n8 1 1\n11 1 1\n11 1 1\n12 1 1\n12 1 1\n15 1 1\n17 1 1\n22 1 1\n23 1 1";

/** The pane's statGroups for these plain defaults: blank line between groups, spaces between values. */
const groups = (s: string): number[][] => s.split(/\n\s*\n|;/).map((g) => g.trim().split(/[\s,]+/).filter(Boolean).map(Number));

/** Every number token of the reading (signs and % dropped) appears in the text or a table cell. */
function missingNumbers(o: Out): string[] {
  const hay = [o.text, ...(o.tables ?? []).flatMap((t) => t.rows.flat())].join("\n");
  const toks = (o.reading ?? "").match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return toks.map((t) => t.replace(/,$/, "")).filter((t) => !hay.includes(t));
}

function good(o: Out): string {
  expect(o.ok).not.toBe(false);
  expect(readingProblems(o.reading)).toEqual([]);
  expect(missingNumbers(o)).toEqual([]);
  return o.reading as string;
}

const COX_NULL = [
  "time status x",
  ...[5, 8, 12, 15, 20, 22, 25, 30, 6, 9, 13, 16, 21, 24, 26, 31].map((t, i) => `${t} ${i % 3 === 2 ? 0 : 1} ${i % 2}`),
].join("\n");
/** The 6-MP default with an unrelated "age" column added. */
const COX_TWO = COX_DEFAULT.split("\n")
  .map((l, i) => (i === 0 ? `${l} age` : `${l} ${40 + ((i * 13) % 23)}`))
  .join("\n");

describe("defaults carry a reading that keeps the rules, with every number printed", () => {
  const cases: [string, () => Out][] = [
    ["ts-arima", () => tsArimaCalc(reader(TS_ARIMA_DEFAULTS))],
    ["ts-ets", () => tsEtsCalc(reader(TS_ETS_DEFAULTS))],
    ["es-event", () => esEventCalc(reader(ES_EVENT_DEFAULTS))],
    ["idx-price", () => idxPriceCalc(reader(IDX_PRICE_DEFAULTS))],
    ["idx-deflate", () => idxDeflateCalc(reader(IDX_DEFLATE_DEFAULTS))],
    ["rmanova", () => rmAnovaCalc(RM_DEFAULT, "holm")],
    ["cox", () => coxCalc(COX_DEFAULT, "efron")],
    ["welchanova", () => welchAnovaCalc(groups(WELCH_DEFAULT))],
    ["gameshowell", () => gamesHowellCalc(groups(WELCH_DEFAULT), "0.05")],
  ];
  test.each(cases)("%s", (_id, run) => {
    good(run());
  });
});

describe("readings follow the result", () => {
  test("ts-arima: forecasts by period, one period, residual check", () => {
    const d = good(tsArimaCalc(reader(TS_ARIMA_DEFAULTS)));
    expect(d).toMatch(/^ARIMA\(1, 1, 1\) forecasts Rate at about [\d.]+ for 2026 Q1, (rising|falling) to about [\d.]+ by 2027 Q4, with a 95% range of/);
    expect(d).toMatch(/Ljung–Box p/);
    const one = good(tsArimaCalc(reader(TS_ARIMA_DEFAULTS, { h: "1", p: "2", d: "0", q: "0" })));
    expect(one).not.toBe(d);
    expect(one).toMatch(/^ARIMA\(2, 0, 0\) with a mean forecasts|^ARIMA\(2, 0, 0\) forecasts Rate at about [\d.]+ for 2026 Q1, with a 95% range of/);
  });

  test("ts-ets: additive has a range; multiplicative has none", () => {
    const add = good(tsEtsCalc(reader(TS_ETS_DEFAULTS)));
    expect(add).toMatch(/^Holt–Winters forecasts Sales .* with a 95% range of .*the wider the range\.$/);
    const mul = good(tsEtsCalc(reader(TS_ETS_DEFAULTS, { seasonal: "mul" })));
    expect(mul).not.toMatch(/95%/);
    const ses = good(tsEtsCalc(reader(TS_ETS_DEFAULTS, { trend: "none", seasonal: "none", h: "3" })));
    expect(ses).toMatch(/^Simple exponential smoothing forecasts Sales at about ([\d.,]+) for January 2026, holding at about \1 by March 2026/);
  });

  test("es-event: direction and significance", () => {
    const d = good(esEventCalc(reader(ES_EVENT_DEFAULTS)));
    expect(d).toMatch(/^Across the 2 events, the average stock/);
    const acme = good(esEventCalc(reader(ES_EVENT_DEFAULTS, { events: "Acme: 2024-08-01", ev_from: "−1", ev_to: "0" })));
    expect(acme).toBe(
      "The stock rose by about 3.687% beyond what the market explains over event days (−1, 0), an abnormal reaction unlikely to be chance alone (J₁ = 2.291, p = 0.022).",
    );
    const bor = good(esEventCalc(reader(ES_EVENT_DEFAULTS, { events: "Borealis: 2024-08-19", ev_from: "0", ev_to: "0" })));
    expect(bor).toMatch(/^The stock fell by about 4\.562% .*\(J₁ = −4\.225, p <\s0\.001\)\.$/);
    // p = 0.054: just above the line, so no claim.
    const near = good(esEventCalc(reader(ES_EVENT_DEFAULTS, { events: "Acme: 2024-08-01", ev_from: "0", ev_to: "0" })));
    expect(near).toMatch(/no clear abnormal reaction \(J₁ = 1\.927, p = 0\.054\), so a move this size could be chance\.$/);
  });

  test("idx-price: Fisher with the spread; one formula; base at the end", () => {
    const d = good(idxPriceCalc(reader(IDX_PRICE_DEFAULTS)));
    expect(d).toMatch(/^By the Fisher index, the basket costs [\d.]+ in 2024 for every 100 it cost in 2021, so prices are higher; the 4 formulas range from/);
    const l = good(idxPriceCalc(reader(IDX_PRICE_DEFAULTS, { formula: "laspeyres" })));
    expect(l).toMatch(/^By the Laspeyres index.*higher\.$/);
    const back = good(idxPriceCalc(reader(IDX_PRICE_DEFAULTS, { base: "2024" })));
    expect(back).toMatch(/costs [\d.]+ in 2021 for every 100 it cost in 2024, so prices are lower in 2021 than in 2024/);
  });

  test("idx-deflate: real rise or fall, inflation sign", () => {
    const d = good(idxDeflateCalc(reader(IDX_DEFLATE_DEFAULTS)));
    expect(d).toMatch(/^In 2024 dollars, Revenue went from [\d,.]+ in 2015 to 1,952,000\.00 in 2024, a real increase after inflation; prices rose 32\.20% from 2015 to 2024\.$/);
    const fall = good(
      idxDeflateCalc(reader(IDX_DEFLATE_DEFAULTS, { data: "Year\tRevenue\tCPI\n2020\t100\t100\n2021\t101\t110\n2022\t102\t120" })),
    );
    expect(fall).toMatch(/a real decrease after inflation; prices rose 20\.00%/);
    const defl = good(
      idxDeflateCalc(reader(IDX_DEFLATE_DEFAULTS, { data: "Year\tRevenue\tCPI\n2020\t100\t100\n2021\t100\t95\n2022\t100\t90" })),
    );
    expect(defl).toMatch(/a real increase after inflation; prices fell 10\.00% from 2020 to 2022\.$/);
  });

  test("rmanova: not significant on Field's default; significant; interaction first", () => {
    const d = good(rmAnovaCalc(RM_DEFAULT, "holm"));
    expect(d).toMatch(/^The data show no clear change in the mean across the 4 conditions \(p = 0\.0626 after the Greenhouse–Geisser correction\)/);
    const s = good(rmAnovaCalc("10 12 14\n9 11 15\n12 13 16\n8 10 13\n11 12 15", "holm"));
    expect(s).toMatch(/^The mean changes across the 3 conditions \(p < 0\.0001 after the Huynh–Feldt correction; partial η² = /);
    expect(s).toMatch(/from [\d.]+ \(condition 1\) to [\d.]+ \(condition 3\)/);
    const mix = good(rmAnovaCalc("A 1 5 9\nA 2 6 10\nA 1 6 9\nB 9 5 1\nB 10 6 2\nB 9 5 2", "holm"));
    expect(mix).toMatch(/^How the mean changes across the 3 conditions differs between the groups/);
  });

  test("cox: association wording, not significant, several covariates", () => {
    const d = good(coxCalc(COX_DEFAULT, "efron"));
    expect(d).toBe(
      "In these data, placebo at 1 rather than 0 goes with about 4.817 times the hazard of the event (95% CI 2.147 to 10.81, p = 0.00014), " +
        "a higher risk; that is an association, not by itself a causal effect.",
    );
    const n = good(coxCalc(COX_NULL, "efron"));
    expect(n).toMatch(/^The data give no clear evidence that x at 1 rather than 0 changes the hazard/);
    const two = good(coxCalc(COX_TWO, "efron"));
    expect(two).toMatch(/^Of the 2 covariates, the clearest link is that placebo at 1 rather than 0 goes with about [\d.]+ times/);
    // The 6-MP times and events with the treatment column replaced by two unrelated covariates.
    const nullTwo = COX_DEFAULT.split("\n")
      .map((l, i) => (i === 0 ? "time status x w" : `${l.split(" ").slice(0, 2).join(" ")} ${i % 2} ${(i * 5) % 7}`))
      .join("\n");
    const twoNull = good(coxCalc(nullTwo, "efron"));
    expect(twoNull).toMatch(/^Of the 2 covariates, none shows a clear link to the hazard of the event; the closest is (x|w) \(hazard ratio about/);
  });

  test("welchanova: significant on the default, not on overlapping groups", () => {
    const d = good(welchAnovaCalc(groups(WELCH_DEFAULT)));
    expect(d).toMatch(/^The group means differ somewhere \(F\(3, 8\.3\) = 5\.89, p = \.019\): group 3 averages highest/);
    const n = good(welchAnovaCalc([[1, 2, 3, 4], [2, 3, 4, 5], [1.5, 2.5, 3.5, 4.6]]));
    // Counts in words, as every Stats reading writes them (R4 #11 number style).
    expect(n).toMatch(/^The data show no clear difference among the three group means/);
  });

  test("gameshowell: the engine's own significant pairs, larger mean first", () => {
    const d = good(gamesHowellCalc(groups(WELCH_DEFAULT), "0.05"));
    expect(d).toMatch(/^Two of the six pairs differ at α = 0\.05 after allowing for every comparison: group 3 averages [\d.]+ higher than group 2 \(p = \.015\)/);
    const n = good(gamesHowellCalc([[1, 2, 3, 4], [2, 3, 4, 5], [1.5, 2.5, 3.5, 4.6]], "0.05"));
    expect(n).toMatch(/^No pair of groups differs clearly at α = 0\.05 once all three comparisons are allowed for/);
    const two = good(gamesHowellCalc([[1, 2, 3], [10, 11, 12.5]], "0.01"));
    expect(two).toMatch(/^The two groups differ at α = 0\.01 .*group 2 averages [\d.]+ higher than group 1/);
  });

  test("adversarial pass: long numbers fit; two groups or conditions need no post-hoc pointer", () => {
    const big = "y\n" + Array.from({ length: 40 }, (_, i) => (-1000 - i * 50 + (i % 3)).toFixed(2)).join("\n");
    const a = good(tsArimaCalc(reader(TS_ARIMA_DEFAULTS, { data: big, h: "3" })));
    expect(a).toMatch(/^ARIMA\(1, 1, 1\) forecasts y at about −3,002\.03 1 period ahead, falling to about/);
    expect(a).toMatch(/treat the forecasts with care\.$/);
    const rm2 = good(rmAnovaCalc("1 3\n2 5\n3 6\n2 4", "holm"));
    expect(rm2).toMatch(/^The mean changes across the 2 conditions .*\(condition 2\)\.$/);
    const w2 = good(welchAnovaCalc([[1, 2, 3], [10, 11, 12.5]]));
    expect(w2).toMatch(/^The two group means differ \(F\(1, [\d.]+\) = [\d.]+, p [<=] \.\d+\): group 2 averages highest/);
  });

  test("a refusal carries no reading", () => {
    expect(welchAnovaCalc([[1, 2, 3]]).reading).toBeUndefined();
    expect(rmAnovaCalc("1", "holm").reading).toBeUndefined();
    expect(coxCalc("time status\n1 1", "efron").reading).toBeUndefined();
    expect(tsArimaCalc(reader(TS_ARIMA_DEFAULTS, { data: "x\n1\n2" })).reading).toBeUndefined();
    expect(idxDeflateCalc(reader(IDX_DEFLATE_DEFAULTS, { data: "" })).reading).toBeUndefined();
  });
});
