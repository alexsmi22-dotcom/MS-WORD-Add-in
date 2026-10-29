/**
 * THE FIGURE-STYLE GATE (2026-10-28, "fully inclusive" figure fix). Every Finance and Statistics figure reachable from
 * lib is redrawn through the shared figure context (lib/figContext.ts figureRenderer — the render callback the pane
 * hands to prepareFigure) and inserted under EVERY figure style at EVERY width it offers, exactly as the pane inserts it
 * (insertCapability.prepareFigure). Each must be accepted.
 *
 * What is covered:
 *  - every calculator in the library registries the pane spreads into FIN_CALCS and STAT_CALCS (read from the pane's
 *    own spread lines, so a new registry is covered the day it is spread), on its defaults;
 *  - the Statistics calculators the pane defines inline but computes in lib (econ-ols … macro-taylor, rmanova, cox,
 *    welchanova, gameshowell), on the pane's defaults;
 *  - the shared builders the remaining inline Finance and Statistics calculators draw with (box plots, Kaplan–Meier,
 *    regression diagnostics, forest and grouped bars, horizontal bars with the caller's own labels, money-over-time,
 *    cash-flow ladders, bond and option curves, the damages date axes, the currency bars), called as those calculators
 *    call them.
 *
 * A case that genuinely cannot meet a style is a NAMED EXCEPTION below with its reason, and the gate pins the set both
 * ways: a new refusal fails, and so does an exception that has started to pass (remove it).
 */
import * as fs from "fs";
import * as path from "path";
import type { FinCalcDef, FinResult } from "../finCalc";
import type { StatCalcDef } from "../statCalc";
import type { StatOutput } from "../analyzeBlocks";
import { readFinanceField } from "../finance";
import { figureRenderer } from "../figContext";
import { prepareFigure, type FigurePresetChoice } from "../insertCapability";
import type { PresetWidth } from "../figureStyle";
import { econLogitCalc, econOlsCalc, econRegTableCalc, ECON_SPEC_DEFAULT, ECON_SPECS_DEFAULT, LOGIT_DEFAULT, LOGIT_SPEC_DEFAULT, LONGLEY_DEFAULT } from "../econCalcs";
import { tsAcfCalc, tsUnitRootCalc, tsHpCalc, TS_ACF_DEFAULTS, TS_UNITROOT_DEFAULTS, TS_HP_DEFAULTS } from "../tsCalcs";
import { tsArimaCalc, tsEtsCalc, TS_ARIMA_DEFAULTS, TS_ETS_DEFAULTS } from "../tsForecastCalcs";
import { esEventCalc, idxPriceCalc, idxDeflateCalc, ES_EVENT_DEFAULTS, IDX_PRICE_DEFAULTS, IDX_DEFLATE_DEFAULTS } from "../econE3Calcs";
import { panelFeCalc, panelReCalc, panelDidCalc, PANEL_FE_DEFAULTS, PANEL_RE_DEFAULTS, PANEL_DID_DEFAULTS } from "../panelCalcs";
import { bootCiCalc, qregCalc, BOOT_CI_DEFAULTS, QREG_DEFAULTS } from "../robustCalcs";
import { ineqGiniCalc, concHhiCalc, ioLeontiefCalc, finCurrencyCalc, INEQ_GINI_DEFAULTS, CONC_HHI_DEFAULTS, IO_LEONTIEF_DEFAULTS, FIN_CURRENCY_DEFAULTS } from "../econE5aCalcs";
import { microMarketCalc, microOligopolyCalc, MICRO_MARKET_DEFAULTS, MICRO_OLIGOPOLY_DEFAULTS } from "../microCalcs";
import { IV_2SLS_DEFAULTS } from "../ivCalcs";
import { GAME_NASH_DEFAULTS, MACRO_SOLOW_DEFAULTS, MACRO_ISLM_DEFAULTS, MACRO_TAYLOR_DEFAULTS } from "../gameMacroCalcs";
import { gameNashWithReading, iv2slsWithReading, macroIslmWithReading, macroSolowWithReading, macroTaylorWithReading } from "../statPaneModelReadings";
import { rmAnovaCalc, coxCalc } from "../statsBatchCalcs";
import { welchAnovaCalc, gamesHowellCalc } from "../welchCalcs";
import { boxPlotSvg, forestPlotSvg, groupedBarSvg } from "../statchart";
import { hBarSvg } from "../mechchart";
import { buildPlotSvg, combineSvgs } from "../plot";
import { kaplanMeierSvg } from "../survivalFigure";
import { kaplanMeier } from "../survival";
import { moneyOverTimeSvg, cashFlowLadderSvg, bondPriceCurveSvg, optionCurveSvg, finPlotSvg, finMoney, finPct } from "../financeFigures";
import { blackScholes, bondPrice } from "../finance";
import { finCurrencyWithFigure } from "../finPaneFigures";
import { prejudgmentReport, postjudgmentReport } from "../damagesInterest";
import { damagesFigure } from "../patentDamages";
import { bracketedBoxPlot } from "../statsBrackets";
import { twoSampleTTest } from "../stats";
import { tukeyHSD } from "../tukey";
import { currentFigCtx } from "../figContext";

const SRC = path.join(__dirname, "..", "..");
const PANE = fs.readFileSync(path.join(SRC, "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");

/** The library registries the pane spreads into `anchor`'s array, loaded from the module it imports each from. */
function spreads<T>(anchor: string): T[] {
  const i = PANE.indexOf(anchor);
  if (i < 0) throw new Error(`${anchor} not found in the pane`);
  const body = PANE.slice(i, PANE.indexOf("\n];", i));
  return [...body.matchAll(/^\s*\.\.\.([A-Z][A-Z0-9_]*_CALCS),/gm)].flatMap((m) => {
    const imp = new RegExp(`import \\{[^}]*\\b${m[1]}\\b[^}]*\\} from "\\.\\./lib/([A-Za-z0-9]+)"`).exec(PANE);
    if (!imp) throw new Error(`no import of ${m[1]}`);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(path.join(SRC, "lib", imp[1]))[m[1]] as T[];
  });
}

/** Finance: number fields through the product's cell reader, as the pane reads them. */
function runFin(c: FinCalcDef): FinResult {
  const raw = (k: string): string => c.fields.find((f) => f.key === k)?.default ?? "";
  const numeric = new Map<string, string>();
  for (const f of c.fields) {
    if (f.kind === "select" || f.kind === "list" || f.kind === "text" || f.kind === "block") continue;
    const v = readFinanceField(raw(f.key));
    if (Number.isFinite(v)) numeric.set(f.key, String(v));
  }
  return c.compute((k) => numeric.get(k) ?? raw(k));
}
const finSvg = (o: FinResult): string | undefined => (typeof o === "string" || o.ok === false ? undefined : o.svg);
const statSvg = (o: StatOutput): string | undefined => (o.ok === false ? undefined : o.svg);
const reader = (d: Record<string, string>) => (k: string): string => d[k] ?? "";

interface Case {
  id: string;
  draw: () => string | undefined;
}

const ECON_OPTS = { constant: "yes", se: "classical", cluster: "", lag: "", decimals: "3", stars: "econ" };
const WELCH = [
  [63, 57, 52, 41, 43],
  [32, 39, 51, 30, 35],
  [62, 60, 71, 55, 48],
  [42, 50, 41, 37],
];
const RM =
  "Stick_insect Kangaroo_testicle Fish_eye Witchetty_grub\n8 7 1 6\n9 5 2 5\n6 2 3 8\n5 3 1 9\n8 4 5 8\n7 5 6 7\n10 2 7 2\n12 6 8 1";
const COX =
  "time status placebo\n6 1 0\n6 1 0\n6 1 0\n6 0 0\n7 1 0\n9 0 0\n10 1 0\n10 0 0\n11 0 0\n13 1 0\n16 1 0\n17 0 0\n19 0 0\n20 0 0\n22 1 0\n23 1 0\n25 0 0\n32 0 0\n32 0 0\n34 0 0\n35 0 0\n1 1 1\n1 1 1\n2 1 1\n2 1 1\n3 1 1\n4 1 1\n4 1 1\n5 1 1\n5 1 1\n8 1 1\n8 1 1\n8 1 1\n8 1 1\n11 1 1\n11 1 1\n12 1 1\n12 1 1\n15 1 1\n17 1 1\n22 1 1\n23 1 1";

/** The Statistics calculators the pane defines inline and computes in lib, on the pane's defaults. */
const STAT_INLINE_LIB: Case[] = [
  { id: "econ-ols", draw: () => statSvg(econOlsCalc(reader({ data: LONGLEY_DEFAULT, spec: ECON_SPEC_DEFAULT, ...ECON_OPTS }))) },
  { id: "econ-regtable", draw: () => statSvg(econRegTableCalc(reader({ data: LONGLEY_DEFAULT, specs: ECON_SPECS_DEFAULT, ...ECON_OPTS }))) },
  { id: "econ-logit", draw: () => statSvg(econLogitCalc(reader({ data: LOGIT_DEFAULT, spec: LOGIT_SPEC_DEFAULT, model: "logit", se: "classical", constant: "yes" }))) },
  { id: "econ-probit", draw: () => statSvg(econLogitCalc(reader({ data: LOGIT_DEFAULT, spec: LOGIT_SPEC_DEFAULT, model: "probit", se: "classical", constant: "yes" }))) },
  { id: "ts-acf", draw: () => statSvg(tsAcfCalc(reader(TS_ACF_DEFAULTS))) },
  { id: "ts-unitroot", draw: () => statSvg(tsUnitRootCalc(reader(TS_UNITROOT_DEFAULTS))) },
  { id: "ts-hp", draw: () => statSvg(tsHpCalc(reader(TS_HP_DEFAULTS))) },
  { id: "ts-arima", draw: () => statSvg(tsArimaCalc(reader(TS_ARIMA_DEFAULTS))) },
  { id: "ts-ets", draw: () => statSvg(tsEtsCalc(reader(TS_ETS_DEFAULTS))) },
  { id: "es-event", draw: () => statSvg(esEventCalc(reader(ES_EVENT_DEFAULTS))) },
  { id: "idx-price", draw: () => statSvg(idxPriceCalc(reader(IDX_PRICE_DEFAULTS))) },
  { id: "idx-deflate", draw: () => statSvg(idxDeflateCalc(reader(IDX_DEFLATE_DEFAULTS))) },
  { id: "iv-2sls", draw: () => statSvg(iv2slsWithReading(reader(IV_2SLS_DEFAULTS))) },
  { id: "panel-fe", draw: () => statSvg(panelFeCalc(reader(PANEL_FE_DEFAULTS))) },
  { id: "panel-re", draw: () => statSvg(panelReCalc(reader(PANEL_RE_DEFAULTS))) },
  { id: "panel-did", draw: () => statSvg(panelDidCalc(reader(PANEL_DID_DEFAULTS))) },
  { id: "boot-ci", draw: () => statSvg(bootCiCalc(reader(BOOT_CI_DEFAULTS))) },
  { id: "qreg", draw: () => statSvg(qregCalc(reader(QREG_DEFAULTS))) },
  { id: "ineq-gini", draw: () => statSvg(ineqGiniCalc(reader(INEQ_GINI_DEFAULTS))) },
  { id: "conc-hhi", draw: () => statSvg(concHhiCalc(reader(CONC_HHI_DEFAULTS))) },
  { id: "io-leontief", draw: () => statSvg(ioLeontiefCalc(reader(IO_LEONTIEF_DEFAULTS))) },
  { id: "micro-market", draw: () => statSvg(microMarketCalc(reader(MICRO_MARKET_DEFAULTS))) },
  { id: "micro-oligopoly", draw: () => statSvg(microOligopolyCalc(reader(MICRO_OLIGOPOLY_DEFAULTS))) },
  { id: "game-nash", draw: () => statSvg(gameNashWithReading(reader(GAME_NASH_DEFAULTS))) },
  { id: "macro-solow", draw: () => statSvg(macroSolowWithReading(reader(MACRO_SOLOW_DEFAULTS))) },
  { id: "macro-islm", draw: () => statSvg(macroIslmWithReading(reader(MACRO_ISLM_DEFAULTS))) },
  { id: "macro-taylor", draw: () => statSvg(macroTaylorWithReading(reader(MACRO_TAYLOR_DEFAULTS))) },
  { id: "rmanova", draw: () => statSvg(rmAnovaCalc(RM, "holm")) },
  { id: "cox", draw: () => statSvg(coxCalc(COX, "efron")) },
  { id: "welchanova", draw: () => statSvg(welchAnovaCalc(WELCH)) },
  { id: "gameshowell", draw: () => statSvg(gamesHowellCalc(WELCH, "0.05")) },
];

const TIMES = [6, 6, 6, 7, 10, 13, 16, 22, 23, 6, 9, 10, 11, 17, 19, 20, 25, 32];
const EVENTS = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/**
 * A significance-bracket figure as the pane redraws it (updateStatsPreview: the bracket builder at the figure context's
 * width, inside figureRenderer). A bracket set that no longer fits throws, as the pane's render does.
 */
function bracketCase(fig: (w: number | undefined) => { ok: boolean; svg: string; error?: string }): () => string {
  return () => {
    const r = fig(currentFigCtx()?.width);
    if (!r.ok) throw new Error(r.error ?? "brackets do not fit");
    return r.svg;
  };
}
const TA = [5.1, 4.9, 6.2, 5.8, 6.0, 5.5, 5.3];
const TB = [6.8, 7.1, 6.5, 7.4, 6.9, 7.7, 7.0];

/** The shared builders as the inline Statistics calculators call them (taskpane.ts STAT_CALCS). */
const STAT_INLINE_BUILDERS: Case[] = [
  {
    id: "brackets: twosample, stars",
    draw: bracketCase((w) =>
      bracketedBoxPlot([{ label: "group 1", values: TA }, { label: "group 2", values: TB }], { title: "Welch two-sample t-test", ylabel: "value" }, { kind: "t", result: twoSampleTTest(TA, TB) }, { label: "stars", hideNs: false, tall: false }, w),
    ),
  },
  {
    id: "brackets: tukey, p values",
    draw: bracketCase((w) =>
      bracketedBoxPlot(
        WELCH.map((g, i) => ({ label: `group ${i + 1}`, values: g })),
        { title: "Tukey HSD (4 groups)", ylabel: "value" },
        { kind: "tukey", result: tukeyHSD(WELCH)! },
        { label: "p", hideNs: false, tall: false },
        w,
      ),
    ),
  },
  {
    id: "brackets: tukey, p values, taller with ns hidden",
    draw: bracketCase((w) =>
      bracketedBoxPlot(
        WELCH.map((g, i) => ({ label: `group ${i + 1}`, values: g })),
        { title: "Tukey HSD (4 groups)", ylabel: "value" },
        { kind: "tukey", result: tukeyHSD(WELCH)! },
        { label: "p", hideNs: true, tall: true },
        w,
      ),
    ),
  },
  { id: "box (descriptive, t-tests, ANOVA, rank tests)", draw: () => boxPlotSvg(WELCH.map((v, i) => ({ label: `Group ${i + 1}`, values: v })), { title: "One-way ANOVA (4 groups)", ylabel: "value" }) },
  { id: "box one group (descriptive)", draw: () => boxPlotSvg([{ label: "data", values: [2, 4, 4, 4, 5, 5, 7, 9] }], { title: "Distribution", ylabel: "value" }) },
  { id: "kaplan-meier (survival)", draw: () => kaplanMeierSvg([{ km: kaplanMeier(TIMES, EVENTS), label: "S(t)" }], { title: "Kaplan–Meier" }) },
  {
    id: "kaplan-meier by group (logrank)",
    draw: () =>
      kaplanMeierSvg(
        [
          { km: kaplanMeier(TIMES.slice(0, 9), EVENTS.slice(0, 9)), label: "Group 1" },
          { km: kaplanMeier(TIMES.slice(9), [1, 1, 0, 1, 0, 1, 1, 0, 1]), label: "Group 2" },
        ],
        { title: "Survival by group" },
      ),
  },
  {
    id: "regression diagnostics (regression, multiregress, polyregress)",
    draw: () => {
      const fit = [1, 2, 3, 4, 5, 6, 7, 8];
      const res = [0.3, -0.2, 0.1, -0.4, 0.2, 0.05, -0.1, 0.05];
      const a = buildPlotSvg([{ type: "scatter", points: fit.map((f, i) => ({ x: f, y: res[i] })), color: "#0369a1" }], { width: 300, height: 190, title: "Residuals vs fitted", xlabel: "Fitted", ylabel: "Residual" });
      const b = buildPlotSvg(
        [
          { type: "scatter", points: res.map((r, i) => ({ x: -1.5 + (3 * i) / 7, y: r * 3 })), color: "#0369a1" },
          { type: "line", points: [{ x: -1.5, y: -1.5 }, { x: 1.5, y: 1.5 }], color: "#94a3b8" },
        ],
        { width: 300, height: 190, title: "Normal Q-Q", xlabel: "Theoretical quantile", ylabel: "Standardized residual" },
      );
      const fitPlot = buildPlotSvg(
        [
          { type: "scatter", points: fit.map((x, i) => ({ x, y: 2 * x + res[i] })), color: "#0369a1", label: "data" },
          { type: "line", points: [{ x: 1, y: 2 }, { x: 8, y: 16 }], color: "#b91c1c", label: "fitted line" },
        ],
        { title: "y = 2x", xlabel: "x", ylabel: "y" },
      );
      return combineSvgs([fitPlot, combineSvgs([a, b]).svg]).svg;
    },
  },
  {
    id: "forest (dunnett, tukey)",
    draw: () =>
      forestPlotSvg(
        [
          { label: "treatment 1", estimate: 4.2, low: 1.1, high: 7.3 },
          { label: "treatment 2", estimate: -1.5, low: -4.6, high: 1.6 },
          { label: "treatment 3", estimate: 0.4, low: -2.7, high: 3.5 },
        ],
        { title: "Dunnett: each treatment against control (95% simultaneous CI)", xlabel: "treatment − control", zero: 0 },
      ),
  },
  { id: "grouped bars (chigof, chiind, multcomp)", draw: () => groupedBarSvg(["A", "B", "C", "D"], [{ label: "observed", values: [18, 22, 31, 29] }, { label: "expected", values: [25, 25, 25, 25] }], { title: "Observed and expected counts", ylabel: "count" }) },
  { id: "grouped bars (twoway)", draw: () => groupedBarSvg(["B1", "B2", "B3"], [{ label: "A1", values: [4.1, 5.2, 6.3] }, { label: "A2", values: [3.9, 6.1, 7.7] }], { title: "Cell means (A × B)", ylabel: "mean value" }) },
  {
    id: "hbar (uncertainty)",
    draw: () =>
      hBarSvg(
        [
          { name: "mass of the long-named sample holder", value: 0.0412, text: "0.0412" },
          { name: "V", value: 0.0183, text: "0.0183" },
        ],
        { title: "Contribution to combined uncertainty (same units as the result)", unit: "" },
      ),
  },
  {
    id: "power curve (power)",
    draw: () =>
      buildPlotSvg(
        [
          { type: "line", points: Array.from({ length: 30 }, (_, i) => ({ x: 4 + 2 * i, y: 1 - Math.exp(-(4 + 2 * i) / 25) })), color: "#0369a1", label: "power" },
          { type: "line", points: [{ x: 4, y: 0.8 }, { x: 62, y: 0.8 }], color: "#b91c1c", label: "target 0.8" },
        ],
        { title: "Power against sample size per group", xlabel: "n per group", ylabel: "power" },
      ),
  },
];

const P = 10000;
/** The shared builders as the inline Finance calculators call them (taskpane.ts FIN_CALCS). */
const FIN_INLINE_BUILDERS: Case[] = [
  { id: "money over time (fv, pv, compound, annuity, cagr …)", draw: () => moneyOverTimeSvg({ periods: 10, valueAt: (k) => P * Math.pow(1.05, k), title: "Value over time", xlabel: "period" }) },
  { id: "cash-flow ladder (npv, irr, dcf, xirr)", draw: () => cashFlowLadderSvg([-1000, 300, 400, 500, 200], [-1000, 272.73, 330.58, 375.66, 136.6], "Discounted cash flows", { resultLabel: "NPV" }) },
  { id: "cash-flow ladder, 12 flows", draw: () => cashFlowLadderSvg(Array.from({ length: 12 }, (_, i) => (i ? 150 : -1000)), Array.from({ length: 12 }, (_, i) => (i ? 150 / Math.pow(1.08, i) : -1000)), "Discounted cash flows") },
  { id: "bond price curve (bond, ytm, bondrisk)", draw: () => bondPriceCurveSvg({ face: 1000, coupon: 0.05, ytm: 0.06, years: 10, freq: 2, price: bondPrice(1000, 0.05, 0.06, 10, 2) }) },
  { id: "option curve (bs)", draw: () => optionCurveSvg({ type: "call", s: 100, k: 100, t: 1, r: 0.05, sig: 0.2, price: blackScholes("call", 100, 100, 1, 0.05, 0.2) }) },
  {
    id: "two-series plot (loan, amort, depr, greeks, returns)",
    draw: () =>
      finPlotSvg(
        [
          { points: Array.from({ length: 31 }, (_, k) => ({ x: k, y: 200000 * (1 - k / 30) })), type: "line", color: "#2563eb", label: "balance" },
          { points: Array.from({ length: 31 }, (_, k) => ({ x: k, y: 186511.57 * (k / 30) })), type: "line", color: "#b91c1c", label: "cumulative interest paid" },
        ],
        { width: 380, height: 250, title: "Loan balance and interest paid over 30 years", xlabel: "year", ylabel: "amount" },
      ),
  },
  {
    id: "hbar (ear)",
    draw: () =>
      hBarSvg(
        [1, 2, 4, 12, 52, 365].map((f) => ({ name: `${f}× a year`, value: (Math.pow(1 + 0.12 / f, f) - 1) * 100, text: finPct(Math.pow(1 + 0.12 / f, f) - 1), colour: f === 12 ? "#b91c1c" : "#2563eb" })),
        { title: "Effective annual rate by compounding frequency (%)", unit: "" },
      ),
  },
  {
    id: "hbar (rate-forms)",
    draw: () =>
      hBarSvg(
        [1, 4, 12, 365].map((f) => ({ name: `${f}× a year`, value: P * Math.pow(1 + 0.06 / f, f * 10), text: finMoney(P * Math.pow(1 + 0.06 / f, f * 10)) })),
        { title: "Amount after 10 years, by compounding", unit: "" },
      ),
  },
  { id: "fin-currency", draw: () => finSvg(finCurrencyWithFigure(finCurrencyCalc(reader(FIN_CURRENCY_DEFAULTS)))) },
  {
    id: "dmg-prejudgment (date axis)",
    draw: () =>
      prejudgmentReport({
        tranches: ["Date\tDamages", "2019-03-15\t125,000.00", "2020-12-31\t250,000.50", "2022-06-30\t98,765.43"].join("\n"),
        rates: ["From\tRate %", "2018-01-01\t5.00", "2020-07-01\t3.25", "2022-01-01\t7.50"].join("\n"),
        end: "2024-02-29",
        method: "annual",
        dayCount: "act365",
        midPeriod: "off",
      }).svg,
  },
  { id: "dmg-postjudgment (date axis)", draw: () => postjudgmentReport({ amount: 1500000, ratePct: 4.12, judgment: "2024-03-15", payment: "2026-10-24", dayCount: "act365" }).svg },
  { id: "damages columns (royalty, lost profits, summary)", draw: () => damagesFigure(["2021", "2022", "2023", "2024"], [{ name: "reasonable royalty", values: [48000, 66000, 75000, 37200] }], "Reasonable royalty by period") },
];

/** A library calculator on inputs other than its defaults (the reviewers' figure cases). */
function finLibCase(id: string, label: string, over: Record<string, string>): Case {
  const c = spreads<FinCalcDef>("const FIN_CALCS: FinCalc[] = [").find((x) => x.id === id);
  if (!c) throw new Error(`no calculator ${id}`);
  const raw = (k: string): string => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "";
  const run = (): FinResult => {
    const numeric = new Map<string, string>();
    for (const f of c.fields) {
      if (f.kind === "select" || f.kind === "list" || f.kind === "text" || f.kind === "block") continue;
      const v = readFinanceField(raw(f.key));
      if (Number.isFinite(v)) numeric.set(f.key, String(v));
    }
    return c.compute((k) => numeric.get(k) ?? raw(k));
  };
  return { id: `${id} (${label})`, draw: () => finSvg(run()) };
}
const TAB = String.fromCharCode(9);
const stmt = (rows: string[][]): string => rows.map((r) => r.join(TAB)).join(String.fromCharCode(10));
const EQUITY = "Shareholders’ equity";
/** R3's figure cases (2026-10-28): a loss-making statement with a negative cash cycle, and a hostile one. */
const FIN_LIB_HOSTILE: Case[] = [
  finLibCase("fin-ratios", "a loss year, negative cash cycle", {
    stmt: stmt([
      ["Line item", "This year", "Prior year"],
      ["Revenue", "2,400,000", "2,600,000"],
      ["Cost of goods sold", "1,700,000", "1,750,000"],
      ["Operating income", "-80,000", "150,000"],
      ["Interest expense", "60,000", "55,000"],
      ["Income tax expense", "0", "20,000"],
      ["Net loss", "140,000", ""],
      ["Cash", "40,000", "90,000"],
      ["Marketable securities", "10,000", "10,000"],
      ["Accounts receivable", "300,000", "280,000"],
      ["Inventory", "500,000", "420,000"],
      ["Total current assets", "850,000", "800,000"],
      ["Total assets", "2,000,000", "2,100,000"],
      ["Accounts payable", "260,000", "200,000"],
      ["Total current liabilities", "900,000", "600,000"],
      ["Total liabilities", "1,600,000", "1,560,000"],
      [EQUITY, "400,000", "540,000"],
    ]),
  }),
  finLibCase("fin-ratios", "a 250,000,000× interest coverage", {
    stmt: stmt([
      ["Line item", "This year", "Prior year"],
      ["Revenue", "1,000,000,000", "900,000,000"],
      ["Net income", "-50,000,000", "10,000,000"],
      ["Interest expense", "1", "1"],
      ["Operating income", "250,000,000", "1"],
      ["Total current assets", "5", "3"],
      ["Total current liabilities", "1,000,000", "1,000,000"],
      ["Total assets", "2,000,000,000", "1,900,000,000"],
      [EQUITY, "-100,000,000", "50,000,000"],
      ["Inventory", "1", "1"],
      ["Cost of goods sold", "999,999,999", "899,999,999"],
      ["Accounts receivable", "1", "2"],
      ["Accounts payable", "1", "1"],
    ]),
  }),
  finLibCase("cvp-breakeven", "sales below break-even", { price: "125", vc: "80", fixed: "270,000", units: "5500", target: "45,000" }),
  finLibCase("cba-pigou", "no external cost", { a: "100", b: "1", c: "10", d: "0.5", e0: "200", e1: "0" }),
  finLibCase("corp-dcf", "exit multiple, mid-year", { fcf: "200, 180, 210, 240", wacc: "8.5", fade: "3", fadestart: "", terminal: "exit", multiple: "8", metric: "320", timing: "mid", netdebt: "1,500", shares: "" }),
];

const CASES: Case[] = [
  ...spreads<FinCalcDef>("const FIN_CALCS: FinCalc[] = [").map((c) => ({ id: c.id, draw: () => finSvg(runFin(c)) })),
  ...spreads<StatCalcDef>("const STAT_CALCS: StatCalc[] = [").map((c) => ({ id: c.id, draw: () => statSvg(c.compute((k) => c.fields.find((f) => f.key === k)?.default ?? "")) })),
  ...STAT_INLINE_LIB,
  ...STAT_INLINE_BUILDERS,
  ...FIN_INLINE_BUILDERS,
  ...FIN_LIB_HOSTILE,
];

const PRESETS: Exclude<FigurePresetChoice, "asdrawn">[] = ["nature", "elsevier", "acs", "cell", "thesis", "uspto"];
const WIDTHS: PresetWidth[] = ["single", "oneAndHalf", "double"];
/** USPTO sheets have no 1.5-column width (figureStyle.ts: oneAndHalf is []); every other style offers all three. */
const offered = (p: string, w: PresetWidth): boolean => !(p === "uspto" && w === "oneAndHalf");

/**
 * Cases that genuinely cannot meet a style, each with its reason. Key: "<case id> <preset>/<width>".
 */
const EXCEPTIONS: Record<string, string> = {
  // The 5-step CRR lattice draws 6 nodes in its widest row, each two 12 px numerals wide ("103.05" over "7.62"): the
  // layout is 394 units wide at its narrowest legible spacing, and 8 pt text in a 75 mm column needs at most 318.
  // It meets every other style and width; the 150 mm thesis width takes it.
  "deriv-crr thesis/single": "a 6-node-wide lattice cannot be drawn narrow enough for 8 pt text in 75 mm",
  // corp-dcf's sensitivity grid is a heat map: its shading carries the value scale, and black-and-white line art has
  // no honest way to draw a continuous shade (USPTO refuses heat maps outright: figureStyle.ts refusedChartKinds).
  // It is refused by name for its grey fills; every journal style takes it.
  "corp-dcf uspto/single": "a heat map's shading cannot be drawn in black-and-white line art (37 CFR 1.84(a)(1))",
  "corp-dcf uspto/double": "a heat map's shading cannot be drawn in black-and-white line art (37 CFR 1.84(a)(1))",
  "corp-dcf (exit multiple, mid-year) uspto/single": "a heat map (as corp-dcf above)",
  "corp-dcf (exit multiple, mid-year) uspto/double": "a heat map (as corp-dcf above)",
  // The default econ-regtable has six terms × three models: six forest panels. At USPTO lettering (3.52 mm) even two
  // to a row they need 272 mm, above the 244 mm sight; fewer terms fit. Every journal style takes it.
  "econ-regtable uspto/single": "six coefficient panels at USPTO lettering need more than the 244 mm sight",
  "econ-regtable uspto/double": "six coefficient panels at USPTO lettering need more than the 244 mm sight",
  // Tukey on four groups with every pair bracketed and labelled with its p: six brackets need 110 px above the data,
  // more than 60% of the plot at a single column (and on the USPTO sight, where the lettering fills the plot). The
  // bracket builder refuses BY NAME with the remedy ("tick Taller figure or Hide ns"), and with that remedy the same
  // figure meets every style and width ("brackets: tukey, p values, taller with ns hidden" above).
  ...Object.fromEntries(
    ["nature/single", "elsevier/single", "acs/single", "cell/single", "thesis/single", "thesis/oneAndHalf", "uspto/single", "uspto/double"].map((k) => [
      `brackets: tukey, p values ${k}`,
      "six p-value brackets do not fit a single-column plot; refused by name with the remedy, which passes",
    ]),
  ),
};

describe("every Finance and Statistics figure meets every figure style at every width", () => {
  const failures = new Map<string, string>();
  let accepted = 0;
  let total = 0;
  const drewNothing: string[] = [];
  /** The slowest style insert (its re-renders included), reported for the integrator: a style re-runs the calculator. */
  let slowest = { id: "", ms: 0 };
  beforeAll(() => {
    for (const c of CASES) {
      let svg: string | undefined;
      try {
        svg = c.draw();
      } catch {
        svg = undefined;
      }
      if (!svg) {
        drewNothing.push(c.id);
        continue;
      }
      // Style compliance, not time: no re-render budget here (figContext.test.ts checks the budget), because jest on a
      // loaded machine runs the calculators several times slower than the production bundle.
      const render = figureRenderer(c.draw, Number.POSITIVE_INFINITY);
      for (const p of PRESETS)
        for (const w of WIDTHS) {
          if (!offered(p, w)) continue;
          total++;
          const t0 = Date.now();
          const r = prepareFigure({ svg, preset: p, width: w, render });
          const ms = Date.now() - t0;
          if (ms > slowest.ms) slowest = { id: `${c.id} ${p}/${w}`, ms };
          if (r.ok) accepted++;
          else failures.set(`${c.id} ${p}/${w}`, `${r.reason}: ${r.problems.join("; ")}`);
        }
    }
  });

  test("the corpus is the whole surface: every inline family draws, and the spread calculators that draw nothing are the known ones", () => {
    const inline = new Set([...STAT_INLINE_LIB, ...STAT_INLINE_BUILDERS, ...FIN_INLINE_BUILDERS].map((c) => c.id));
    expect(drewNothing.filter((id) => inline.has(id))).toEqual([]);
    // Every spread calculator draws on its defaults (a figure that silently stops drawing would leave the gate).
    expect(drewNothing).toEqual([]);
    expect(total).toBeGreaterThan(2000);
  });

  test("no refusal outside the named exceptions", () => {
    const unexpected = [...failures.entries()].filter(([k]) => !(k in EXCEPTIONS)).map(([k, v]) => `${k}: ${v.slice(0, 300)}`);
    if (process.env.FIG_GATE_OUT) {
      const head = `accepted ${accepted}/${total}; slowest ${slowest.id} ${slowest.ms} ms; drew nothing: ${drewNothing.join(", ")}`;
      fs.writeFileSync(process.env.FIG_GATE_OUT, [head, ...unexpected].join("\n"));
    }
    expect(unexpected).toEqual([]);
  });

  test("every named exception is still refused (an exception that passes must be removed)", () => {
    expect(Object.keys(EXCEPTIONS).filter((k) => !failures.has(k))).toEqual([]);
  });
});
