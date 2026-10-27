/**
 * Release F2 (v2.203.0) calculators for gap items #6 and #20, spread into the pane's FIN_CALCS under the group
 * "Litigation damages" (US dollars, like the other damages tools):
 *  - dmg-sec-ribbon     Securities: inflation ribbon (constant dollar or constant percentage)   engine securitiesDamages.ts
 *  - dmg-sec-oop        Securities: out-of-pocket loss by purchase/sale window, FIFO or LIFO    engine securitiesDamages.ts
 *  - dmg-pslra          Securities: PSLRA 90-day lookback, 15 U.S.C. § 78u-4(e)                 engine securitiesDamages.ts
 *  - dmg-sec-aggregate  Securities: aggregate damages by a trading model (labelled a model)     engine securitiesDamages.ts
 *  - dmg-antitrust      Antitrust: overcharge (dummy-variable and forecast), pass-through       engine antitrustDamages.ts
 *
 * The worked defaults are invented numbers (no client data, no published case figures).
 */
import type { FinCalcDef } from "./finCalc";
import { secRibbonCalc, secOutOfPocketCalc, pslraLookbackCalc, secAggregateCalc } from "./securitiesDamages";
import { antitrustCalc } from "./antitrustDamages";

const RIBBON_PRICES = [
  "Date\tClose",
  "2025-03-03\t41.82",
  "2025-03-04\t41.47",
  "2025-03-05\t41.62",
  "2025-03-06\t41.20",
  "2025-03-07\t41.23",
  "2025-03-10\t41.10",
  "2025-03-11\t40.66",
  "2025-03-12\t40.67",
  "2025-03-13\t40.22",
  "2025-03-14\t40.15",
  "2025-03-17\t37.54",
  "2025-03-18\t37.16",
  "2025-03-19\t36.79",
  "2025-03-20\t36.72",
  "2025-03-21\t37.01",
  "2025-03-24\t36.68",
  "2025-03-25\t36.43",
  "2025-03-26\t36.55",
  "2025-03-27\t36.94",
  "2025-03-28\t37.01",
  "2025-03-31\t33.49",
  "2025-04-01\t33.41",
  "2025-04-02\t33.79",
  "2025-04-03\t33.42",
  "2025-04-04\t33.71",
].join("\n");

const DROPS = ["Disclosure date\tInflation removed per share", "2025-03-17\t2.4893", "2025-03-31\t3.4419"].join("\n");

const LOOKBACK_CLOSES = [
  "Date\tClose",
  ...(
    "2025-03-31 35.19|2025-04-01 34.82|2025-04-02 34.42|2025-04-03 34.23|2025-04-04 34.59|2025-04-07 34.26|2025-04-08 34.37|2025-04-09 34.53|" +
    "2025-04-10 34.41|2025-04-11 34.48|2025-04-14 34.03|2025-04-15 33.58|2025-04-16 33.29|2025-04-17 33.50|2025-04-21 33.44|2025-04-22 33.26|" +
    "2025-04-23 33.37|2025-04-24 33.33|2025-04-25 33.14|2025-04-28 33.46|2025-04-29 33.69|2025-04-30 33.44|2025-05-01 33.53|2025-05-02 33.57|" +
    "2025-05-05 33.98|2025-05-06 34.24|2025-05-07 34.03|2025-05-08 34.55|2025-05-09 34.16|2025-05-12 34.09|2025-05-13 34.38|2025-05-14 34.03|" +
    "2025-05-15 34.03|2025-05-16 33.56|2025-05-19 33.76|2025-05-20 34.05|2025-05-21 34.14|2025-05-22 34.56|2025-05-23 34.38|2025-05-27 34.60|" +
    "2025-05-28 34.72|2025-05-29 34.82|2025-05-30 34.79|2025-06-02 35.18|2025-06-03 35.68|2025-06-04 35.67|2025-06-05 35.87|2025-06-06 35.40|" +
    "2025-06-09 35.64|2025-06-10 35.82|2025-06-11 36.38|2025-06-12 36.76|2025-06-13 36.54|2025-06-16 36.43|2025-06-17 36.63|2025-06-18 36.11|" +
    "2025-06-20 36.09|2025-06-23 35.73|2025-06-24 35.33|2025-06-25 34.86|2025-06-26 35.17|2025-06-27 34.78|2025-06-30 34.53"
  )
    .split("|")
    .map((s) => s.replace(" ", "\t")),
].join("\n");

const VOLUME = [
  "Date\tVolume",
  ...(
    "2025-03-03 2,401,000|2025-03-04 2,833,000|2025-03-05 1,130,000|2025-03-06 1,481,000|2025-03-07 2,639,000|2025-03-10 2,445,000|" +
    "2025-03-11 3,050,000|2025-03-12 1,938,000|2025-03-13 1,360,000|2025-03-14 2,563,000|2025-03-17 3,053,000|2025-03-18 1,940,000|" +
    "2025-03-19 2,501,000|2025-03-20 2,269,000|2025-03-21 2,358,000|2025-03-24 1,745,000|2025-03-25 1,418,000|2025-03-26 1,139,000|" +
    "2025-03-27 1,521,000|2025-03-28 1,419,000|2025-03-31 1,750,000|2025-04-01 1,755,000"
  )
    .split("|")
    .map((s) => s.replace(" ", "\t")),
].join("\n");

const ANTITRUST_DATA = [
  "Month\tPeriod\tPrice\tCost\tDemand",
  ...(
    "2019-01 before 97.13 49.05 185.1|2019-02 before 101.42 49.88 202.0|2019-03 before 102.28 51.56 200.5|2019-04 before 102.15 51.90 186.6|" +
    "2019-05 before 105.32 52.72 211.2|2019-06 before 100.38 51.57 197.0|2019-07 before 100.89 52.94 186.9|2019-08 before 100.47 51.64 189.9|" +
    "2019-09 before 99.14 51.41 185.0|2019-10 before 100.55 52.01 195.9|2019-11 before 105.81 55.50 203.4|2019-12 before 103.21 53.41 195.4|" +
    "2020-01 during 116.14 53.29 210.5|2020-02 during 114.13 55.06 199.5|2020-03 during 112.93 54.01 195.3|2020-04 during 115.78 57.32 189.8|" +
    "2020-05 during 118.54 58.20 200.8|2020-06 during 116.67 56.97 185.8|2020-07 during 122.82 59.11 210.9|2020-08 during 116.08 56.64 196.0|" +
    "2020-09 during 122.01 59.09 201.0|2020-10 during 119.30 57.72 191.7|2020-11 during 125.34 60.74 210.6|2020-12 during 122.47 60.47 207.2|" +
    "2021-01 after 109.60 59.67 195.7|2021-02 after 108.28 58.11 193.4|2021-03 after 114.59 61.17 213.7|2021-04 after 118.11 62.55 214.6|" +
    "2021-05 after 111.03 60.66 191.6|2021-06 after 111.99 60.39 191.1"
  )
    .split("|")
    .map((s) => s.split(" ").join("\t")),
].join("\n");

const PASS_THROUGH = ["Quarter\tCost\tResale price", "2019-Q1\t100.94\t131.20", "2019-Q2\t102.62\t132.65", "2019-Q3\t100.17\t130.48", "2019-Q4\t104.16\t134.01", "2020-Q1\t114.40\t139.95", "2020-Q2\t116.99\t141.82", "2020-Q3\t120.30\t143.47", "2020-Q4\t122.37\t145.36"].join("\n");

export const LITIG_CALCS: FinCalcDef[] = [
  {
    id: "dmg-sec-ribbon",
    group: "Litigation damages",
    name: "Securities: inflation ribbon",
    fields: [
      { key: "prices", label: "Daily closes from the class-period start: date, close (one row per trading day)", default: RIBBON_PRICES, kind: "block" },
      {
        key: "disclosures",
        label: "Corrective disclosures: date, abnormal return (or inflation removed per share in dollars)",
        default: ["Disclosure date\tAbnormal return (%)", "2025-03-17\t−6.20", "2025-03-31\t−9.30"].join("\n"),
        kind: "block",
      },
      {
        key: "mode",
        label: "Ribbon",
        default: "ar-dollar",
        kind: "select",
        options: [
          { value: "ar-dollar", label: "Constant dollar: abnormal return × prior close" },
          { value: "ar-pct", label: "Constant percentage: from the abnormal returns" },
          { value: "dollar", label: "Constant dollar: inflation removed per share, as entered" },
        ],
      },
      {
        key: "units",
        label: "Abnormal returns are in",
        default: "percent",
        kind: "select",
        options: [
          { value: "percent", label: "Percent (−6.2 = −6.2%)" },
          { value: "decimal", label: "Decimals (−0.062 = −6.2%)" },
        ],
      },
    ],
    assumes: "the abnormal returns (or dollar drops) at each corrective disclosure are the user's inputs, for example from the event study; the ribbon does not estimate them",
    compute: (r) => {
      // Inflation per share by day and window, backcast from the corrective disclosures.
      return secRibbonCalc(r);
    },
  },
  {
    id: "dmg-sec-oop",
    group: "Litigation damages",
    name: "Securities: out-of-pocket loss (FIFO/LIFO)",
    fields: [
      { key: "start", label: "Class-period start date", default: "2025-03-03", kind: "text" },
      { key: "disclosures", label: "Disclosures: date, inflation removed per share in dollars (the ribbon's disclosure table)", default: DROPS, kind: "block" },
      {
        key: "blotter",
        label: "Trade blotter: date, Buy or Sell, shares, price per share",
        default: [
          "Date\tSide\tShares\tPrice",
          "2025-02-20\tBuy\t300\t40.10",
          "2025-03-05\tBuy\t1,000\t41.20",
          "2025-03-10\tBuy\t500\t41.80",
          "2025-03-20\tSell\t600\t36.90",
          "2025-03-25\tBuy\t400\t36.40",
          "2025-04-02\tSell\t700\t33.75",
        ].join("\n"),
        kind: "block",
      },
      { key: "held", label: "Shares held before the class period (not in the blotter)", default: "200" },
      {
        key: "match",
        label: "Matching",
        default: "fifo",
        kind: "select",
        options: [
          { value: "fifo", label: "FIFO (first in, first out)" },
          { value: "lifo", label: "LIFO (last in, first out)" },
        ],
      },
    ],
    assumes: "constant-dollar inflation per share from the disclosures entered; loss = inflation when bought − inflation when sold; the PSLRA cap is applied separately",
    compute: (r) => {
      // Matches sales to purchases (FIFO or LIFO) and prices each lot's loss by its purchase and sale windows.
      return secOutOfPocketCalc(r);
    },
  },
  {
    id: "dmg-pslra",
    group: "Litigation damages",
    name: "Securities: PSLRA 90-day lookback",
    fields: [
      { key: "disclosure", label: "Date the corrective information was disseminated", default: "2025-03-31", kind: "text" },
      { key: "prices", label: "Daily closes from that date: date, close", default: LOOKBACK_CLOSES, kind: "block" },
      { key: "purchase", label: "Purchase price per share (optional)", default: "41.20", optional: true },
      { key: "sale", label: "Sale date (optional; blank = held through the 90 days)", default: "", kind: "text", optional: true },
      { key: "loss", label: "Loss per share before the cap (optional, e.g. inflation when bought)", default: "5.9312", optional: true },
    ],
    assumes: "the 90-day period is 90 calendar days from the dissemination date; the mean trading price is the average of the closes given for the trading days in it",
    compute: (r) => {
      // Mean trading price over the 90-day period (or to the sale date), the cap per share, and the lookback table.
      return pslraLookbackCalc(r);
    },
  },
  {
    id: "dmg-sec-aggregate",
    group: "Litigation damages",
    name: "Securities: aggregate damages (trading model)",
    fields: [
      { key: "start", label: "Class-period start date", default: "2025-03-03", kind: "text" },
      { key: "disclosures", label: "Disclosures: date, inflation removed per share in dollars (the ribbon's disclosure table)", default: DROPS, kind: "block" },
      { key: "volume", label: "Daily reported volume: date, shares traded", default: VOLUME, kind: "block" },
      { key: "float", label: "Float (shares available to trade)", default: "50,000,000" },
      { key: "reduction", label: "Volume reduction % (your figure; 0 = reported volume as is)", default: "0" },
      {
        key: "model",
        label: "Trading model",
        default: "both",
        kind: "select",
        options: [
          { value: "both", label: "One-trader and two-trader" },
          { value: "one", label: "One-trader (proportional)" },
          { value: "two", label: "Two-trader" },
        ],
      },
      { key: "activeFloat", label: "Two-trader: active traders' share of the float %", default: "20", optional: true },
      { key: "activeVolume", label: "Two-trader: active traders' share of the volume %", default: "80", optional: true },
    ],
    assumes: "a proportional trading model with the float, volume reduction and trader shares entered: a MODEL that courts have criticized, not a count of claims",
    compute: (r) => {
      // Proportional one-trader / two-trader trading model: aggregate damages by purchase window, every parameter printed.
      return secAggregateCalc(r);
    },
  },
  {
    id: "dmg-antitrust",
    group: "Litigation damages",
    name: "Antitrust: overcharge and pass-through",
    fields: [
      { key: "data", label: "Price table with a header: price, period (before/during/after), optional controls", default: ANTITRUST_DATA, kind: "block" },
      { key: "priceCol", label: "Price column", default: "Price", kind: "text" },
      { key: "periodCol", label: "Period column (before / during / after)", default: "Period", kind: "text" },
      { key: "controls", label: "Control columns (comma-separated; blank = none)", default: "Cost, Demand", kind: "text", optional: true },
      {
        key: "form",
        label: "Price in the regression",
        default: "log",
        kind: "select",
        options: [
          { value: "log", label: "ln(price)" },
          { value: "level", label: "Price (level)" },
        ],
      },
      {
        key: "method",
        label: "Method",
        default: "both",
        kind: "select",
        options: [
          { value: "both", label: "Dummy-variable and forecast" },
          { value: "dummy", label: "Dummy-variable (before and after as benchmark)" },
          { value: "forecast", label: "Forecast (before-period model projected)" },
        ],
      },
      {
        key: "se",
        label: "Standard errors",
        default: "hc1",
        kind: "select",
        options: [
          { value: "classical", label: "Classical" },
          { value: "hc1", label: "HC1 (robust)" },
          { value: "hac", label: "Newey–West HAC (rows in time order)" },
        ],
      },
      { key: "purchases", label: "Purchases by period: period, purchases", default: ["2020-Q1\t1,250,000", "2020-Q2\t1,410,000", "2020-Q3\t1,380,000", "2020-Q4\t1,525,000"].join("\n"), kind: "block" },
      {
        key: "basis",
        label: "Purchases are",
        default: "dollars",
        kind: "select",
        options: [
          { value: "dollars", label: "Dollars paid" },
          { value: "units", label: "Units bought" },
        ],
      },
      {
        key: "pt",
        label: "Pass-through",
        default: "entered",
        kind: "select",
        options: [
          { value: "none", label: "Not shown" },
          { value: "entered", label: "Rate entered" },
          { value: "estimated", label: "Estimated from a cost / resale-price table" },
        ],
      },
      { key: "ptRate", label: "Pass-through rate % (rate entered)", default: "60", optional: true },
      { key: "ptData", label: "Pass-through table: cost, resale price (estimated)", default: PASS_THROUGH, kind: "block", optional: true },
    ],
    assumes: "before and after rows are the competitive benchmark (dummy method), the before rows alone (forecast method); controls, purchases and pass-through are the user's inputs",
    compute: (r) => {
      // Overcharge by the dummy-variable and forecast regressions, damages = overcharge × purchases, pass-through.
      return antitrustCalc(r);
    },
  },
];
