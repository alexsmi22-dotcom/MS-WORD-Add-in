/**
 * Release F1 (v2.202.0) calculators for gap items #1 and #2, spread into the pane's FIN_CALCS under the group
 * "IP valuation & licensing":
 *  - ipv-rfr         Relief-from-royalty valuation (with the optional tax amortization benefit)     engine ipValuation.ts
 *  - ipv-income      Income approach (multi-period excess earnings, simplified)                       engine ipValuation.ts
 *  - ipv-mc          Monte Carlo patent value (PCG32, seeded)                                         engine ipValuation.ts
 *  - ipv-apportion   Apportionment worksheet (US dollars, exact cents)                                engine apportionment.ts
 *  - ipv-emvr-ssppu  EMVR vs SSPPU royalty base (US dollars)                                          engine apportionment.ts
 *  - ipv-comparable  Comparable license: lump sum ⇄ running royalty (US dollars)                      engine apportionment.ts
 *  - ipv-nash        Nash bargaining split (US dollars; the 25% rule of thumb is refused)             engine apportionment.ts
 *
 * The worked defaults are invented numbers (no client data, no published case figures).
 */
import type { FinCalcDef } from "./finCalc";
import { rfrCalc, incomeCalc, mcNpvCalc } from "./ipValuation";
import { apportionCalc, emvrCalc, comparableCalc, nashCalc } from "./apportionment";

const CURRENCY_FIELD = { key: "currency", label: "Currency (ISO 4217 code, optional: blank = bare numbers)", default: "", kind: "text" as const, optional: true };
const TIMING_FIELD = {
  key: "timing",
  label: "Discounting",
  default: "mid",
  kind: "select" as const,
  options: [
    { value: "mid", label: "Mid-year" },
    { value: "end", label: "End of year" },
  ],
};
const DIST_OPTIONS = [
  { value: "tri", label: "Triangular (low, most likely, high)" },
  { value: "logn", label: "Lognormal (P10, P90)" },
  { value: "fixed", label: "Fixed (one value)" },
];

export const IPVAL_CALCS: FinCalcDef[] = [
  {
    id: "ipv-rfr",
    group: "IP valuation & licensing",
    name: "Relief-from-royalty valuation",
    fields: [
      CURRENCY_FIELD,
      {
        key: "mode",
        label: "Revenue forecast",
        default: "block",
        kind: "select",
        options: [
          { value: "block", label: "Pasted by year" },
          { value: "growth", label: "First-year revenue and growth" },
        ],
      },
      {
        key: "forecast",
        label: "Revenue forecast: year, revenue, one per line",
        default: ["2027 4,000,000", "2028 4,600,000", "2029 5,100,000", "2030 5,400,000", "2031 5,500,000", "2032 5,300,000", "2033 5,000,000", "2034 4,600,000"].join("\n"),
        kind: "block",
        optional: true,
      },
      { key: "base", label: "First-year revenue (growth mode)", default: "4000000", optional: true },
      { key: "growth", label: "Revenue growth (% a year, growth mode)", default: "5", optional: true },
      { key: "royalty", label: "Royalty rate (%)", default: "4" },
      { key: "tax", label: "Tax rate (%)", default: "21" },
      { key: "disc", label: "Discount rate (%)", default: "14" },
      { key: "life", label: "Remaining life (years)", default: "7.5" },
      {
        key: "attr",
        label: "Attrition",
        default: "none",
        kind: "select",
        options: [
          { value: "none", label: "None" },
          { value: "straight", label: "Straight-line to zero over the remaining life" },
          { value: "decay", label: "Decay curve (% a year)" },
        ],
      },
      { key: "decay", label: "Attrition (% a year, decay curve)", default: "10", optional: true },
      TIMING_FIELD,
      {
        key: "tab",
        label: "Tax amortization benefit",
        default: "yes",
        kind: "select",
        options: [
          { value: "yes", label: "Include" },
          { value: "no", label: "Leave out" },
        ],
      },
      { key: "tabyears", label: "Amortization period (years)", default: "15", optional: true },
    ],
    assumes:
      "Royalty saved = revenue × royalty rate, taxed at the tax rate and discounted at the annual effective discount rate from the start of year 1; a partial final year is pro rata; " +
      "the TAB factor 1/(1 − t × A/n) uses the same discount rate and timing; the rate, life and attrition are inputs, not estimates made here.",
    compute: (r) => {
      // Relief-from-royalty value by year, with the TAB when asked.
      return rfrCalc(r);
    },
  },
  {
    id: "ipv-income",
    group: "IP valuation & licensing",
    name: "Income approach (excess earnings)",
    fields: [
      CURRENCY_FIELD,
      {
        key: "flows",
        label: "Cash flows: year, incremental cash flow, contributory asset charges (optional), one per line",
        default: ["2027 900,000 150,000", "2028 1,150,000 180,000", "2029 1,300,000 200,000", "2030 1,350,000 210,000", "2031 1,300,000 205,000", "2032 1,150,000 190,000"].join("\n"),
        kind: "block",
      },
      {
        key: "basis",
        label: "Cash flows are",
        default: "pre",
        kind: "select",
        options: [
          { value: "pre", label: "Before tax (taxed here)" },
          { value: "after", label: "After tax" },
        ],
      },
      { key: "tax", label: "Tax rate (%)", default: "21", optional: true },
      { key: "disc", label: "Discount rate (%)", default: "15" },
      { key: "life", label: "Remaining life (years)", default: "6" },
      {
        key: "attr",
        label: "Obsolescence",
        default: "straight",
        kind: "select",
        options: [
          { value: "none", label: "None" },
          { value: "straight", label: "Straight-line to zero over the remaining life" },
          { value: "decay", label: "Decay curve (% a year)" },
        ],
      },
      { key: "decay", label: "Obsolescence (% a year, decay curve)", default: "12", optional: true },
      TIMING_FIELD,
    ],
    assumes:
      "Excess earnings = incremental cash flow attributable to the patent less the contributory asset charges entered, taxed (when before tax) and multiplied by the obsolescence curve, " +
      "discounted at the annual effective rate; a simplified multi-period excess earnings model with no working-capital or other adjustments beyond the charges entered.",
    compute: (r) => {
      // Simplified excess-earnings value by year.
      return incomeCalc(r);
    },
  },
  {
    id: "ipv-mc",
    group: "IP valuation & licensing",
    name: "Monte Carlo patent value",
    fields: [
      CURRENCY_FIELD,
      { key: "revdist", label: "First-year revenue distribution", default: "tri", kind: "select", options: DIST_OPTIONS },
      { key: "rev", label: "First-year revenue (low, most likely, high / P10, P90 / value)", default: "2500000, 4000000, 6000000", kind: "list" },
      { key: "growth", label: "Revenue growth (% a year)", default: "3" },
      { key: "ratedist", label: "Royalty rate distribution", default: "tri", kind: "select", options: DIST_OPTIONS },
      { key: "rate", label: "Royalty rate (%) (low, most likely, high / P10, P90 / value)", default: "2, 4, 6", kind: "list" },
      { key: "lifedist", label: "Remaining life distribution", default: "tri", kind: "select", options: DIST_OPTIONS },
      { key: "life", label: "Remaining life (years) (low, most likely, high / P10, P90 / value)", default: "4, 8, 12", kind: "list" },
      { key: "discdist", label: "Discount rate distribution", default: "logn", kind: "select", options: DIST_OPTIONS },
      { key: "disc", label: "Discount rate (%) (low, most likely, high / P10, P90 / value)", default: "10, 18", kind: "list" },
      { key: "tax", label: "Tax rate (%)", default: "21" },
      { key: "cost", label: "Price paid today", default: "600000" },
      TIMING_FIELD,
      {
        key: "attr",
        label: "Attrition",
        default: "none",
        kind: "select",
        options: [
          { value: "none", label: "None" },
          { value: "straight", label: "Straight-line to zero over each drawn life" },
        ],
      },
      { key: "samples", label: "Samples (1,000 to 100,000)", default: "50000" },
      { key: "seed", label: "Seed (whole number)", default: "20261027", kind: "text" },
    ],
    assumes:
      "The four uncertain inputs are drawn independently (no correlation); revenue grows at the fixed rate from the drawn first-year revenue; NPV = after-tax royalty income discounted at the drawn rate less the price paid today; " +
      "the same seed gives the same result.",
    compute: (r) => {
      // Seeded Monte Carlo NPV: mean, SD, P10/P50/P90, probability of a loss, histogram.
      return mcNpvCalc(r);
    },
  },
  {
    id: "ipv-apportion",
    group: "IP valuation & licensing",
    name: "Apportionment worksheet",
    fields: [
      {
        key: "basis",
        label: "Royalty base",
        default: "revenue",
        kind: "select",
        options: [
          { value: "revenue", label: "Revenue" },
          { value: "unit", label: "Units × price per unit" },
        ],
      },
      { key: "revenue", label: "Revenue ($)", default: "120000000", kind: "text", optional: true },
      { key: "units", label: "Units (units × price)", default: "400000", optional: true },
      { key: "price", label: "Price per unit ($, units × price)", default: "300", kind: "text", optional: true },
      { key: "ssu", label: "Smallest salable unit share (%)", default: "30" },
      { key: "feature", label: "Feature share (%)", default: "40" },
      { key: "patent", label: "Patent share (%)", default: "60" },
      { key: "rate", label: "Royalty rate (%)", default: "5" },
    ],
    assumes:
      "Each share is an input: the share of the base's value in the smallest salable patent-practicing unit, the patented feature's share of that unit, and the patent's share of the feature; " +
      "the worksheet multiplies them out and does not choose them.",
    compute: (r) => {
      // Base → SSPPU share → feature share → patent share → royalty, exact cents.
      return apportionCalc(r);
    },
  },
  {
    id: "ipv-emvr-ssppu",
    group: "IP valuation & licensing",
    name: "EMVR vs SSPPU royalty base",
    fields: [
      {
        key: "basis",
        label: "Bases entered as",
        default: "revenue",
        kind: "select",
        options: [
          { value: "revenue", label: "Revenues" },
          { value: "unit", label: "Units and prices per unit" },
        ],
      },
      { key: "emv", label: "Entire-product revenue ($)", default: "120000000", kind: "text", optional: true },
      { key: "ssppu", label: "SSPPU revenue ($)", default: "18000000", kind: "text", optional: true },
      { key: "units", label: "Units (units and prices)", default: "400000", optional: true },
      { key: "emvprice", label: "Entire-product price per unit ($)", default: "300", kind: "text", optional: true },
      { key: "ssppuprice", label: "SSPPU price per unit ($)", default: "45", kind: "text", optional: true },
      { key: "rate", label: "Royalty rate (%)", default: "3" },
    ],
    assumes: "The same royalty rate is applied to both bases; the figures are calculations only and do not say which base is appropriate.",
    compute: (r) => {
      // The same rate on the entire-product base and on the SSPPU base, side by side.
      return emvrCalc(r);
    },
  },
  {
    id: "ipv-comparable",
    group: "IP valuation & licensing",
    name: "Comparable license: lump sum ⇄ running royalty",
    fields: [
      {
        key: "direction",
        label: "Convert",
        default: "lump2rate",
        kind: "select",
        options: [
          { value: "lump2rate", label: "Lump sum → effective running rate" },
          { value: "rate2lump", label: "Running rate → lump-sum equivalent" },
        ],
      },
      {
        key: "periods",
        label: "Royalty base forecast: period, revenue, one per line",
        default: ["2027 20,000,000", "2028 24,000,000", "2029 27,000,000", "2030 28,000,000", "2031 26,000,000"].join("\n"),
        kind: "block",
      },
      { key: "lump", label: "Lump sum ($)", default: "2500000", kind: "text", optional: true },
      { key: "rate", label: "Running royalty rate (%)", default: "2.5", optional: true },
      { key: "disc", label: "Discount rate (% a year)", default: "10" },
      {
        key: "ppy",
        label: "Periods per year",
        default: "1",
        kind: "select",
        options: [
          { value: "1", label: "1 (annual)" },
          { value: "4", label: "4 (quarterly)" },
          { value: "12", label: "12 (monthly)" },
        ],
      },
    ],
    assumes:
      "The lump sum is paid at the start of the first period; the running royalty is paid at the end of each period on the forecast base; both are compared at the discount rate entered. " +
      "Unpacking a real license also needs its terms (scope, field, term, other consideration), which are not modelled.",
    compute: (r) => {
      // Lump sum ⇄ effective running rate over a discounted forecast base.
      return comparableCalc(r);
    },
  },
  {
    id: "ipv-nash",
    group: "IP valuation & licensing",
    name: "Nash bargaining split",
    fields: [
      {
        key: "method",
        label: "Split method",
        default: "nash",
        kind: "select",
        options: [
          { value: "nash", label: "Nash bargaining split (share from the facts of the case)" },
          { value: "rule25", label: "25% rule of thumb (not offered: explains why)" },
        ],
      },
      { key: "with", label: "Profit with the patented feature ($)", default: "9000000", kind: "text" },
      { key: "alt", label: "Profit with the next-best alternative ($)", default: "6500000", kind: "text" },
      { key: "share", label: "Patentee share of the surplus (%)", default: "50" },
      { key: "units", label: "Units (optional, for a per-unit royalty)", default: "", optional: true },
      { key: "revenue", label: "Revenue ($, optional, for a rate on revenue)", default: "", kind: "text", optional: true },
    ],
    assumes:
      "The surplus is the licensee's profit with the patented feature over its next-best non-infringing alternative; the patentee share is an input that must come from the facts of the case. " +
      "The 25% rule of thumb is refused, with the Federal Circuit's holding quoted.",
    compute: (r) => {
      // Surplus × patentee share, with the caution; the 25% rule refused.
      return nashCalc(r);
    },
  },
];
