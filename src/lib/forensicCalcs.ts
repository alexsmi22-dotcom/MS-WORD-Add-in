/**
 * Release F2 (v2.203.0) calculators for gap items #8 and #17, spread into the pane's FIN_CALCS:
 *  - dmg-lost-earnings-lpe  Lost earnings, forensic grade (LPE / worklife expectancy), US dollars   "Litigation damages"
 *  - act-annuity            Life annuity factors and commutation functions                          "Time value & loans"
 *  - act-retire             Retirement accumulation and drawdown schedule                           "Time value & loans"
 *  - act-swr-mc             Safe-withdrawal Monte Carlo (probability of ruin, PCG32 seeded)         "Time value & loans"
 * Engines: forensicEarnings.ts, lifeTable.ts (+ usLifeTable2024.ts, CDC NVSR Vol. 75 No. 5), retirement.ts; readers
 * and result builders: forensicReports.ts.
 *
 * The worked defaults are invented numbers (no client data). The participation and employment rows are round
 * invented figures, not taken from any worklife table.
 */
import type { FinCalcDef, FinField } from "./finCalc";
import { LIFE_TABLE_OPTIONS } from "./lifeTable";
import { lpeCalc, annuityCalc, retireCalc, swrCalc } from "./forensicReports";

const TABLE_FIELD = (def: string): FinField => ({ key: "table", label: "Life table", default: def, kind: "select", options: LIFE_TABLE_OPTIONS });
const USER_TABLE_FIELD: FinField = {
  key: "usertable",
  label: "Your life table (only for “Your table”): age, qx (or lx), one row per age",
  default: "",
  kind: "block",
  optional: true,
};

export const FORENSIC_CALCS: FinCalcDef[] = [
  {
    id: "dmg-lost-earnings-lpe",
    group: "Litigation damages",
    name: "Damages: lost earnings, forensic (LPE, life table, household services)",
    fields: [
      { key: "dob", label: "Date of birth", default: "1979-04-12", kind: "text" },
      { key: "injury", label: "Date of injury (or death)", default: "2023-06-30", kind: "text" },
      { key: "trial", label: "Trial date (past / future split)", default: "2026-11-02", kind: "text" },
      TABLE_FIELD("cdc-male"),
      USER_TABLE_FIELD,
      {
        key: "survival",
        label: "Survival measured from",
        default: "trial",
        kind: "select",
        options: [
          { value: "trial", label: "The trial date (living plaintiff)" },
          { value: "injury", label: "The date of injury (wrongful death)" },
        ],
      },
      { key: "base", label: "Pre-injury annual earnings", default: "68,000" },
      { key: "residual", label: "Residual earning capacity per year (offset from loss year 1, in the same base-year terms as the pre-injury earnings and growing with them; 0 if none)", default: "24,000" },
      { key: "growth", label: "Earnings growth (% a year)", default: "3" },
      {
        key: "method",
        label: "Method",
        default: "lpe",
        kind: "select",
        options: [
          { value: "lpe", label: "LPE: life × participation × employment probabilities, to an end age" },
          { value: "wle", label: "Worklife expectancy (years, from your worklife table)" },
        ],
      },
      { key: "workend", label: "Earnings end age (LPE)", default: "67", optional: true },
      {
        key: "pe",
        label: "Participation and employment (LPE): from age, participation %, employment %",
        default: ["From age\tParticipation %\tEmployment %", "40\t88\t96", "50\t84\t96", "55\t76\t95", "60\t58\t95", "65\t32\t94"].join("\n"),
        kind: "block",
        optional: true,
      },
      { key: "wle", label: "Worklife expectancy (years after the injury, from your table)", default: "18", optional: true },
      { key: "fringe", label: "Fringe benefits (% of earnings)", default: "20" },
      { key: "tax", label: "Effective tax rate (%)", default: "12" },
      { key: "consumption", label: "Personal consumption (%, wrongful death; 0 otherwise)", default: "0" },
      { key: "hhhours", label: "Household services lost (hours a week, 0 if none)", default: "8" },
      { key: "hhvalue", label: "Value of household services (an hour)", default: "16" },
      { key: "hhgrowth", label: "Household services growth (% a year)", default: "2.5", optional: true },
      { key: "hhend", label: "Household services end age", default: "75", optional: true },
      {
        key: "dmode",
        label: "Discounting",
        default: "growth",
        kind: "select",
        options: [
          { value: "growth", label: "Growth and discount rate" },
          { value: "ndr", label: "Net discount rate (future held at the trial-year level)" },
        ],
      },
      { key: "discount", label: "Discount rate (% a year)", default: "4.5", optional: true },
      { key: "ndr", label: "Net discount rate (% a year)", default: "1.5", optional: true },
      {
        key: "mid",
        label: "Future losses discounted",
        default: "mid",
        kind: "select",
        options: [
          { value: "mid", label: "Mid-period" },
          { value: "end", label: "End of period" },
        ],
      },
      { key: "pji", label: "Prejudgment interest rate on past losses (% a year, yours)", default: "5" },
      {
        key: "pjimethod",
        label: "Prejudgment interest",
        default: "simple",
        kind: "select",
        options: [
          { value: "simple", label: "Simple" },
          { value: "annual", label: "Compounded annually" },
        ],
      },
    ],
    assumes:
      "Each period's lost earning capacity (pre-injury less residual) grows on the injury anniversaries and is weighted by the probabilities of being alive, participating and employed (LPE) at the middle of the period, " +
      "or runs for the worklife expectancy entered; taxes are one effective rate; household services are weighted by survival only; past losses carry prejudgment interest at your rate; " +
      "the life table, probabilities, worklife figure and every rate are inputs, not opinions on what is appropriate.",
    compute: (r) => {
      // LPE lost earnings with household services, past/future split, prejudgment interest and discounting.
      return lpeCalc(r);
    },
  },
  {
    id: "act-annuity",
    group: "Time value & loans",
    name: "Life annuity factors and commutation functions (äx, ax, Ax)",
    fields: [
      TABLE_FIELD("cdc-total"),
      USER_TABLE_FIELD,
      { key: "age", label: "Age x", default: "65" },
      { key: "rate", label: "Interest rate (% a year, effective)", default: "4" },
      { key: "term", label: "Term n for the temporary values (years)", default: "20" },
      { key: "defer", label: "Deferral m (years)", default: "10" },
      { key: "payment", label: "Annual payment or benefit (0 = factors only)", default: "12,000" },
    ],
    assumes:
      "Annual payments at the effective interest rate entered; death benefits at the end of the year of death; the life table is a period table applied as if it were the person's own mortality.",
    compute: (r) => {
      // äx, ax, Ax with temporary and deferred variants from the commutation columns.
      return annuityCalc(r);
    },
  },
  {
    id: "act-retire",
    group: "Time value & loans",
    name: "Retirement accumulation and drawdown schedule",
    fields: [
      { key: "age", label: "Current age", default: "45" },
      { key: "retire", label: "Retirement age", default: "67" },
      { key: "end", label: "Plan to age", default: "95" },
      { key: "balance", label: "Savings today", default: "250,000" },
      { key: "contrib", label: "Contribution a year until retirement (today's money)", default: "18,000" },
      { key: "withdraw", label: "Withdrawal a year in retirement (today's money)", default: "60,000" },
      { key: "return", label: "Nominal return (% a year)", default: "6" },
      { key: "inflation", label: "Inflation (% a year)", default: "2.5" },
    ],
    assumes: "A fixed return and inflation every year; contributions and withdrawals at the start of each year in today's money, indexed by inflation; no taxes or fees.",
    compute: (r) => {
      // Year-by-year balance with contributions, inflation-indexed withdrawals and the real return.
      return retireCalc(r);
    },
  },
  {
    id: "act-swr-mc",
    group: "Time value & loans",
    name: "Safe-withdrawal Monte Carlo (probability of ruin)",
    fields: [
      { key: "balance", label: "Starting portfolio", default: "1,000,000" },
      { key: "withdraw", label: "Withdrawal a year (today's money)", default: "40,000" },
      { key: "years", label: "Years", default: "30" },
      { key: "mean", label: "Mean real return (% a year)", default: "4" },
      { key: "sd", label: "Standard deviation of the real return (% a year)", default: "12" },
      { key: "paths", label: "Paths (1,000 to 100,000)", default: "20000" },
      { key: "seed", label: "Seed (whole number)", default: "20261027", kind: "text" },
      {
        key: "table",
        label: "Weight by a life table (probability of ruin while alive)",
        default: "cdc-total",
        kind: "select",
        options: [{ value: "none", label: "No life table" }, ...LIFE_TABLE_OPTIONS],
      },
      USER_TABLE_FIELD,
      { key: "age", label: "Age at the start (with a life table)", default: "65", optional: true },
    ],
    assumes:
      "Independent lognormal real returns each year with the mean and standard deviation entered; a constant real withdrawal at the start of each year; no fees or taxes; death independent of returns.",
    compute: (r) => {
      // Seeded PCG32 paths; probability of ruin by year, optionally weighted by survival.
      return swrCalc(r);
    },
  },
];
