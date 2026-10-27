# Gap analysis: finance and economics (2026-10-26, v2.200.0)

Scope: read-only review of `~/word-chem-formula` (branch `currency-symbols`, package 2.200.0). Goal from the user:
"as powerful as STEM". Bar used: Engineering has ~180 grouped calculators across ~20 disciplines; Finance has 33 in
one flat list; economics lives as ~25 entries inside Stats. Items shipped from
`docs/GAP-ANALYSIS-ECONOMICS-2026-10-24.md` (all 15, v2.195 to v2.200) are not proposed again.

## 1. Inventory (verified in code)

### Finance mode: `FIN_CALCS`, `src/taskpane/taskpane.ts:8321`, 33 entries, no grouping
Engines: `src/lib/finance.ts` (707 lines), `financeFigures.ts`, `patentDamages.ts`, `damagesInterest.ts`,
`lostEarnings.ts`, `econE5aCalcs.ts` (currency).

| Area | Keys |
|---|---|
| Time value | `fv`, `pv`, `compound`, `ear`, `rate-forms` (nominal/effective/continuous), `annuity` (ordinary; annuity due as a text line), `gann` (growing annuity PV), `perpetuity` (level + Gordon), `cagr` |
| Loans | `loan` (payment + balance curve), `amort` (summary totals + interest/principal curve; **no schedule table**) |
| Capital budgeting / valuation | `npv`, `irr` (first root only), `xirr` (takes **day offsets, not dates**; 365 basis), `dcf` (Gordon terminal; TV not itemised) |
| Fixed income | `bond` (clean price, coupon-date settlement only), `ytm`, `bondrisk` (Macaulay/modified duration, convexity) |
| Derivatives | `bs` (European, no dividends), `greeks`, `iv` |
| Accounting | `depr` (declining balance, no switch to SL), `depr-sl` |
| Portfolio | `returns` (annualised geometric return, vol, Sharpe) |
| FX | `fin-currency` (user rates, cross rates, ISO 4217 minor units) |
| Litigation damages | `dmg-prejudgment` (simple/compound/daily, rate table, ACT/365, ACT/360, ACT/ACT), `dmg-postjudgment` (28 U.S.C. § 1961, annual compounding on anniversaries), `dmg-lost-earnings` (growth, discount, mid-year, consumption, fringe), `dmg-royalty` (revenue or unit base, single apportionment %, lump-sum comparison), `dmg-lost-profits` (capture, incremental margin, price erosion, capacity), `dmg-summary`, `dmg-gp-worksheet`, `dmg-panduit-worksheet` |

Plus the formula library (`src/lib/formulaLibrary.ts:232-314`): typeset-only finance equations (WACC, CAPM, put–call parity, and others), with no calculators behind them.

### Economics inside Stats: `STAT_CALCS`, `taskpane.ts:10368`
| Area | Keys |
|---|---|
| Regression | `econ-ols` (HC0 to HC3, clustered, Newey–West, diagnostics), `econ-regtable` (any estimator per column), `econ-logit` (logit/probit + marginal effects), `multiregress`, `polyregress`, `regression`, `qreg`, `boot-ci` |
| Causal / panel | `iv-2sls`, `panel-fe`, `panel-re` (+ Hausman), `panel-did` |
| Time series | `ts-acf` (+ Ljung–Box), `ts-unitroot` (ADF, KPSS), `ts-hp`, `ts-arima`, `ts-ets` (Holt–Winters) |
| Finance-econometrics | `es-event` (market model; CAR t-tests, BMP and cross-sectional tests) |
| Prices | `idx-price` (Laspeyres, Paasche, Fisher, Törnqvist), `idx-deflate` (user CPI) |
| IO / distribution / antitrust | `io-leontief`, `ineq-gini` (Gini, Theil, Atkinson, Palma), `conc-hhi` (2023 Merger Guidelines screen) |
| Micro | `micro-market` (**linear** S/D, surplus, tax/subsidy, ceilings and floors), `micro-oligopoly` (monopoly, Cournot, Bertrand, Stackelberg) |
| Games | `game-nash` (pure + mixed, up to 8×8) |
| Macro | `macro-solow`, `macro-islm` (IS–LM + AD–AS, linear), `macro-taylor` |

Also reusable: `survival`, `cox`, `markov` (Solve), `lp.ts` (exact simplex), `optimize`, `curvefit`, `monteCarlo.ts`
(seeded, work-budgeted, Solve verb only), `probdist.ts` (15 distributions, `normalCdfPrecise`), `candlestick.ts`
chart, table import from Word, CSV and xlsx (`dataimport.ts`, `xlsxRead.ts`), and LCOE in Engineering (`energy.ts:984`).

### Absent (no calculator or engine found; keyword hits were unrelated: "mirr" = mirror, "VaR" = var, impulse response = control systems, propensity = MPC in IS–LM, Cobb = Cobb–Douglas in Solow, "life table" in reliability.ts = Weibull life data, MACRS and accrued interest appear only in `assumes` text)
MIRR, payback, profitability index, WACC/CAPM calculators, Sortino, Treynor, VaR/CVaR, drawdown, efficient frontier,
binomial/trinomial trees, American options, dividend yield in BS, futures/forwards, swaps, accrued interest, 30/360,
yield curve bootstrap, Nelson–Siegel, forward rates, DuPont/ratios, MACRS, SYD, break-even (business), relief-from-royalty,
25% rule handling, Monte Carlo NPV, GARCH, Engle–Granger/Johansen, VAR/IRF, Granger causality, GMM, tobit, Heckman,
Poisson/NB regression, RDD, synthetic control, propensity score, Slutsky/utility maximisation, auctions,
Mundell–Fleming, interest parity, growth accounting, price discrimination, life tables.

## 2. Area-by-area comparison

| Area | Have | Missing (what a strong toolkit has) | Depth vs STEM |
|---|---|---|---|
| Corporate finance | NPV, IRR, XIRR, Gordon DCF | WACC, CAPM, levered/unlevered beta (Hamada), MIRR, payback/discounted payback, PI, NPV profile + crossover rate, multi-stage DCF with mid-year convention and EV-to-equity bridge, comparables/multiples, real options, sensitivity/tornado tables | Thin |
| Fixed income | Price/YTM/duration/convexity on coupon dates | Settlement dates, accrued interest, dirty price, day counts (30/360 US, 30E/360, ACT/ACT ICMA), YTC/yield-to-worst, zero/spot bootstrapping, forward rates, Nelson–Siegel(–Svensson), key-rate/effective duration, T-bill discount/BEY | Thin |
| Derivatives | European BS, Greeks, IV | Merton dividend yield q, Black-76, binomial CRR (American), put–call parity check, forwards/futures cost of carry, IRS valuation, payoff/strategy diagrams (spreads, straddles), Monte Carlo pricing | Thin |
| Portfolio / risk | Return, vol, Sharpe | Beta/alpha (CAPM regression), Sortino, Treynor, information ratio, max drawdown, VaR/CVaR (historical, parametric, MC), Markowitz frontier + tangency, Fama–French / Carhart factor regression | Very thin |
| Accounting | DB and SL depreciation | DDB to SL switch, SYD, units of production, MACRS (with Table A-1 conventions), ratio analysis, DuPont 3/5-step, common-size statements, break-even/CVP, working capital and cash conversion cycle | Very thin |
| Personal / actuarial | Annuity, loan | Full amortisation table with extra payments, balloon, ARM; retirement accumulation/drawdown with inflation; life-table annuity factors (äx, Ax), present value of a life annuity | Thin |
| Litigation (patent) | Royalty, lost profits, Panduit, GP, interest, summary | Apportionment chain (SSPPU vs EMVR worksheet), relief-from-royalty / income approach, Monte Carlo patent NPV, royalty-base forecasting, the Nash bargaining split as an explained method, 25% rule as a refusal | Good core, no valuation |
| Litigation (other) | Event study, lost earnings, HHI | Securities damages (inflation ribbon, out-of-pocket loss, PSLRA 90-day lookback cap), antitrust overcharge (before/after, dummy-variable regression), lost-earnings with life/worklife/participation probabilities, taxes, household services, past/future split | Partial |
| Econometrics | Strong (OLS family, IV, panel, DiD, logit, quantile, ARIMA) | GARCH, VAR + IRF + Granger, Engle–Granger/Johansen, tobit, Heckman, Poisson/NB, ordered/multinomial logit, RDD, synthetic control, PSM, GMM / system GMM | Good; time-series and limited-dependent gaps |
| Micro | Linear S/D, oligopoly, Nash | Non-linear/constant-elasticity demand, utility maximisation (Cobb–Douglas, CES, Leontief) with Slutsky decomposition, cost curves (TC/AC/MC/AVC), price discrimination, auctions (revenue equivalence, first/second price) | Partial |
| Macro | Solow, IS–LM/AD–AS, Taylor | Growth accounting / Solow residual, Phillips curve (estimation is already possible with OLS), Mundell–Fleming, interest parity (CIP/UIP), money multiplier, fiscal multipliers with taxes/imports, Ramsey/OLG | Partial |
| Public / environmental / CBA | none | Cost–benefit with NPV, BCR and EIRR, social discount rate scenarios, Pigouvian tax, Harberger triangle (micro-market covers part) | None |
| Presentation | Figures on every finance calc; Word tables only on damages + currency | Amortisation, depreciation, bond cash-flow and DCF schedules as Word tables; financial-statement tables; NPV profile; payoff diagrams | Behind STEM |

## 3. Defects in existing code

| # | Where | Defect | Severity |
|---|---|---|---|
| D1 | `src/lib/finance.ts:174` | `normCdf` is Abramowitz–Stegun 26.2.17 (about 7.5e-8 absolute) and is the only normal CDF used by `blackScholes`, `blackScholesGreeks` and `impliedVolatility`. Meanwhile `probdist.ts:172` has `normalCdfPrecise` (about 1e-16). Measured against Python `math.erfc`: ATM call S = K = 100, t = 1, r = 5%, σ = 20% gives 10.4505756 vs 10.4505836 (error −8.0e-6); K = 150 call −0.25% relative; K = 200 call −1.7%; K = 60 put −0.8%. The resulting implied-vol error is ≤ 5e-5, at most 0.01 vol point at 2 dp. Printed prices are mostly unaffected at 2 dp, but a QuantLib oracle at 1e-8 would fail. Fix: import `normalCdfPrecise`. `finance.ts` is the only file that uses `normCdf`. | Low (S fix) |
| D2 | `taskpane.ts:8387` | Figure title `Balance, compounded 12.00x per year`: ASCII "x" and "12.00" for an integer frequency. `rate-forms` uses "×". | Low (display contract) |
| D3 | `taskpane.ts` `xirr` (≈8738) | Takes "Days from first flow", not dates. Excel XIRR takes dates, and `damagesInterest.ts` already has `parseDateField`. Basis is fixed at 365 (disclosed). | Medium (UX) |
| D4 | `npv`, `irr`, `xirr`, `returns`, `dcf` | `kind: "list"` fields get no "Use table at cursor" / "Open CSV…" bar (only `block` fields do, `taskpane.ts:9363`). Students paste cash flows from Excel. | Medium (UX) |
| D5 | `dcf` (≈8698) | Terminal value, its PV and its share of total value are not printed, although the `assumes` text says TV dominates. There is no mid-year convention, and no net-debt or per-share bridge. | Medium |
| D6 | `irr` (≈8452) | Reports the first root only (disclosed). It does not list the other sign-change roots or draw the NPV profile that shows them. | Low |
| D7 | `amort`, `depr`, `depr-sl` | Schedules are space-padded text lines or figures. `FinTable` (`taskpane.ts:8262`) exists but only damages and currency use it, so there is no year-by-year Word table for the most-requested student output. | Medium |
| D8 | `bs`, `greeks`, `iv` | No dividend yield q. Disclosed in `assumes`, but it is a one-parameter extension (Merton) that every textbook problem uses. | Medium |
| D9 | Home tile `taskpane.ts:2812` | Stats is `audience: ["science"]` with desc "Descriptive, t-tests, ANOVA, uncertainty". Home hides the ~25 econ calculators from legal-chip users and does not describe them; they are reachable only through search (which indexes every registry) or the Stats dropdown. The Finance tile desc (`:2857`) omits damages. | Medium (discoverability) |
| D10 | `FinCalc` interface `taskpane.ts:8267` | No `group` field. A flat dropdown works at 33 entries but not at the 80+ this plan implies. `EngCalc` has `group: EngGroup` (`:14044`). | Structural |
| D11 | `depr` | DB never reaches salvage when factor × (1/life) is small (for example factor 1.5, life 5 leaves 680 undepreciated). Disclosed in `assumes`, but no SL switch option is offered. | Low |

The damages engines (`damagesInterest.ts`, `patentDamages.ts`, `lostEarnings.ts`) read clean: exact cents, day counts,
leap-year handling, § 1961 text quoted, and no bundled legal rates. I found no formula errors there.

## 4. Ranked gaps (value to law firm + students × offline feasibility)

| # | Gap | What it is | Why it matters | Reuses | Size | Oracle |
|---|---|---|---|---|---|---|
| 0 | **Finance grouping + econ discoverability** (structural) | `group` on `FinCalc` (Corporate, Fixed income, Derivatives, Portfolio & risk, Accounting, Personal & actuarial, Litigation, IP valuation); optionally an "Economics" tile or a split of Stats econ into its own mode with a desc that names it; retag the audience | Prerequisite for depth. Without it, 80 calculators in one list is unusable. | `EngCalc` grouping pattern, `calcRegistries` | S–M | n/a (UI test) |
| 1 | **IP valuation: relief-from-royalty + income approach + Monte Carlo patent NPV** | RfR: revenue forecast × royalty × (1 − tax), discounted, with tax amortisation benefit; income approach with an attrition/obsolescence curve; MC NPV over revenue, rate, life and discount (triangular/lognormal inputs, P10/P50/P90, histogram) | Licensing, transactional and damages expert work at the firm; nothing like it exists in Word | `patentDamages` tables, `monteCarlo.ts` (seeded, budgeted), `probdist` | M | numpy-financial + numpy MC with the same seed stream (or analytic mean for linear cases) |
| 2 | **Apportionment worksheet + royalty-rate methods** | Chained apportionment (SSPPU → feature share → patent share), EMVR vs SSPPU side by side, comparable-licence unpacking (lump sum → effective running rate), Nash-bargaining split shown as a method with its criticism; **the 25% rule as an explained refusal**: rejected as a fundamentally flawed tool by the Federal Circuit in *Uniloc USA, Inc. v. Microsoft Corp.*, 632 F.3d 1292 (Fed. Cir. 2011) (verified 2026-10-26 in Patent Bear, slip op. at 41: “the 25 percent rule of thumb is a fundamentally flawed tool for determining a baseline royalty rate in a hypothetical negotiation”; later case law not characterised here) | Apportionment is the most-litigated damages issue; `dmg-royalty` takes a single % | `dmg-royalty`, `FinTable` | M | exact rational arithmetic (fractions) |
| 3 | **Fixed income with dates** | Settlement/maturity dates, accrued interest, clean/dirty, day counts 30/360 US, 30E/360, ACT/ACT ICMA, ACT/360, ACT/365; YTC and yield-to-worst; T-bill discount yield, BEY, money-market yield | Every bond-desk and CFA-level problem; the current model refuses off-coupon dates | `damagesInterest.ts` calendar/day-count machinery, `findRoot`, `bondAnalytics` | M | QuantLib-Python (`FixedRateBond`, `DayCounter`), Excel PRICE/YIELD/ACCRINT via LibreOffice |
| 4 | **Portfolio and risk** | Beta/alpha (CAPM regression with SEs), Sortino, Treynor, information ratio, max drawdown + figure, VaR/CVaR (historical, parametric normal/t, Monte Carlo), Markowitz frontier with tangency portfolio and CML figure (long-only via LP/QP) | Core finance curriculum; securities-litigation experts use beta and VaR | `econ-ols`, `probdist`, `monteCarlo`, `lp.ts`/`optimize`, block-field table feed | M | numpy, scipy.optimize, PyPortfolioOpt, empyrical / quantstats |
| 5 | **Corporate finance pack** | WACC (with Hamada un/relevering), CAPM cost of equity, MIRR, payback + discounted payback, PI, NPV profile + crossover rate between two projects, EAA, multi-stage DCF (explicit years, fade, terminal by Gordon or exit multiple, mid-year convention, EV → equity → per share), sensitivity grid / tornado | The most common student finance tasks; also valuation-expert work | `finance.ts` npv/irr/dcf, `heatmap.ts` for the sensitivity grid | M | numpy-financial (mirr, npv, irr), hand-checked textbook cases |
| 6 | **Securities damages beyond the event study** | Inflation ribbon from event-study abnormal returns, per-share out-of-pocket loss by purchase/sale window (FIFO/LIFO matching), PSLRA 90-day mean-trading-price cap, aggregate damages via a trading model (one- and two-trader, user-supplied parameters, labelled as a model) | Securities class actions; builds directly on `es-event` | `eventStudy.ts`, `patentDamages` tables | M–L | hand-computed cases plus an independent Python re-implementation |
| 7 | **Derivatives depth** | Merton dividend yield and Black-76 in `bs`/`greeks`/`iv`; CRR binomial tree (European and American, tree figure for small n); put–call parity check; forward/futures cost-of-carry; payoff diagrams for multi-leg strategies; plain-vanilla IRS value from a user discount curve | Textbook coverage and the American-put gap disclosed today | `finance.ts`, `treeSvg.ts`, `finPlotSvg` | M | QuantLib-Python (`BinomialVanillaEngine`, `AnalyticEuropeanEngine`), py_vollib |
| 8 | **Lost earnings, forensic grade** | Life-table survival (CDC NVSS US Life Tables), participation and employment probabilities (LPE method), worklife table **user-supplied** (Skoog–Ciecka–Krueger tables are proprietary), taxes, household services, past vs future split with interest on past, residual earning capacity offset | Personal-injury / employment economics | `lostEarnings.ts`, `survival` helpers | M | hand-checked spreadsheet + Python |
| 9 | **Schedules as Word tables** (see quick wins) | Amortisation with extra payments / balloon / variable rate; depreciation (SL, DB, DDB→SL, SYD, units-of-production, MACRS); bond cash-flow and DCF schedules | Most-requested student output; table packaging already exists | `FinTable`, `amortizationRowAt` | S–M | numpy-financial (ipmt/ppmt), IRS Pub 946 examples |
| 10 | **Time series II: volatility and multivariate** | GARCH(1,1)/GJR/EGARCH by MLE with conditional-vol figure; VAR(p) with lag-order criteria, Granger causality, orthogonalised IRFs with bands, FEVD; Engle–Granger cointegration; Johansen trace/max-eigen | Grad macro/finance econometrics; GARCH is the standard risk model | `arima.ts` optimiser, `tsDiag.ts` ADF + MacKinnon p-value surfaces, `linalg` eigen | L | `arch`, statsmodels `VAR`, `coint`, `coint_johansen` |
| 11 | **Limited dependent / count models** | Poisson and negative binomial (with exposure/offset, IRRs), tobit, Heckman two-step, ordered and multinomial logit | Applied micro staple; plugs into `econ-regtable` | `logitProbit.ts` MLE + sandwich SEs, `regTable` | M–L | statsmodels (`Poisson`, `NegativeBinomial`, `OrderedModel`, `MNLogit`), `py4etrics`/hand Heckman |
| 12 | **Causal inference II** | Sharp/fuzzy RDD (local linear, triangular kernel, IK/CCT bandwidth, binned-scatter figure), synthetic control (constrained weights by QP, gap figure, placebo inference), propensity score (logit score, nearest-neighbour / IPW, balance table) | Policy-evaluation coursework and antitrust/class-cert experts | `econ-logit`, `iv`, `lp.ts`/`optimize` | L | rdrobust (Python), `pysyncon`, `causalinference` / DoWhy |
| 13 | **Accounting and financial-statement analysis** | Ratio suite from a pasted statement (liquidity, leverage, efficiency, profitability), DuPont 3- and 5-step, common-size and trend statements, cash conversion cycle, break-even / CVP with margin-of-safety figure, Altman Z | Business and accounting students; reasonableness checks in damages reports | `dataimport` / table feed, `FinTable`, `hBarSvg` | M | hand-computed textbook cases (exact rationals) |
| 14 | **Micro II** | Constant-elasticity and log-linear demand, utility maximisation (Cobb–Douglas, CES, perfect complements/substitutes) with Marshallian/Hicksian demands and Slutsky decomposition figure, cost curves from a TC function, 1st/3rd-degree price discrimination, auctions (first/second price, revenue equivalence with uniform values) | Intermediate-micro staples; the figures are the value | `micro-market` figure code, CAS (`cas.ts`) for derivatives, `multivar` Lagrange | M | sympy |
| 15 | **Macro II / open economy** | Growth accounting (Solow residual from a pasted series), Mundell–Fleming under fixed and floating rates, CIP/UIP and PPP calculators, money multiplier, open-economy fiscal multipliers, Phillips curve estimation preset (OLS) | Intermediate-macro staples | `macro-islm`, `econ-ols` | S–M | sympy / exact Rat |
| 16 | **Yield curve** | Bootstrap zero curve from par/coupon instruments, forward-rate table, Nelson–Siegel(–Svensson) fit with figure, discount factors exported to the swap/bond tools | Fixed-income course core; feeds #3 and #7 | `curvefit` (NLS), `spline.ts`, #3 day counts | M | QuantLib-Python `PiecewiseLogLinearDiscount`, `nelson_siegel_svensson` package |
| 17 | **Actuarial / retirement** | Life-annuity factors äx, Ax, commutation functions, reverse mortgage-style payout, retirement accumulation and drawdown with inflation and real returns, safe-withdrawal Monte Carlo | Students and personal-injury PV of life care plans | life table from #8, `monteCarlo`, `annuity` | M | actuarial textbook examples (Bowers et al.), Python `lifelib` / hand |
| 18 | **CBA / public economics** | NPV, BCR and EIRR across scenarios with social discount rate choices (user-entered; check the current OMB A-4 version before citing any rate), shadow pricing, Pigouvian tax and externality figure | Policy students; government-contract damages | `npv`/`irr`, `micro-market` | S–M | numpy-financial |
| 19 | **GMM / dynamic panel** | Linear GMM with Hansen J, Arellano–Bond / Blundell–Bond | Grad econometrics; heavy | `iv.ts`, `panel.ts` | L | linearmodels `IVGMM`, pydynpd |
| 20 | **Antitrust damages** | Overcharge by before/during/after (dummy-variable and forecast methods), pass-through rate, damages table | Antitrust practice; mostly a guided wrapper over OLS | `econ-ols`, `FinTable` | S–M | statsmodels |

### Bundled data rules
Anything that needs data shows its source and as-of date, or stays user-supplied.

| Data | Rule |
|---|---|
| Legal interest rates (prejudgment, § 1961 weekly T-yield, state statutory) | **Never bundled.** User-supplied, as today. |
| CDC NVSS US Life Tables | Public domain. May be bundled with table year, NVSS report number and as-of date; user override allowed. |
| Worklife tables (Skoog–Ciecka–Krueger) | Proprietary. User-supplied only. |
| IRS MACRS percentages (Pub 946 Table A-1 etc.) | Public domain. Bundle with publication year and table number, and label the result "not tax advice". Tax brackets for after-tax lost earnings: user-supplied. |
| Fama–French factors, market returns, yield curves, FX | User-supplied (JurisLab is offline; Ken French data is free but changes monthly). |
| BLS CPI-U | Already handled as user-supplied in `idx-deflate`. A dated bundled annual series is optional. |
| OMB Circular A-4 discount rates | User-supplied. A-4 was revised in 2023; check which version is in force before naming any default rate. |

## 5. Quick wins (S-size, a day or less each)

1. D1: swap `normCdf` for `normalCdfPrecise` (`finance.ts:174`).
2. D2: "×" and an integer-aware frequency in the compound figure title.
3. D3/D4: date column for `xirr` via `parseDateField`, and the table/CSV bar on all Finance list fields (cash flows, returns).
4. D5: print terminal value, PV(TV) and TV share in `dcf`; add a mid-year toggle.
5. Amortisation schedule as a Word table (`FinTable`) with extra-payment and balloon options; show interest saved and months saved.
6. Depreciation: DDB→SL switch, SYD, units-of-production as Word tables (MACRS adds bundled Pub 946 tables, so S–M).
7. MIRR, payback, discounted payback, PI, EAA added to the existing `npv`/`irr` output or as one "Capital budgeting" calculator; NPV profile figure listing every IRR root (D6).
8. Merton dividend yield q in `bs`/`greeks`/`iv`, plus a put–call parity line.
9. WACC + CAPM + Hamada calculator.
10. Sortino, Treynor (with user beta), max drawdown added to `returns`.
11. Home: retag Stats to show to all audiences, rename its desc to include econometrics, and add damages to the Finance desc (D9).
12. CIP/UIP/PPP calculator; break-even/CVP calculator.
13. 25% rule refusal text inside `dmg-royalty` help (no calculator), (Uniloc cite verified 2026-10-26).

## 6. Suggested release order
R1: structure + quick wins (#0, 1–13 above). R2: IP valuation and apportionment (#1, #2). R3: fixed income with
dates + yield curve (#3, #16). R4: portfolio/risk + corporate finance (#4, #5). R5: derivatives + securities damages
(#7, #6). R6: lost earnings/actuarial (#8, #17). R7: econometrics II (#10, #11). R8: causal II, micro II, macro II,
accounting, CBA (#12 to #15, #13, #18). #19 GMM last.

**Decision (2026-10-26):** the user picked **all** items (#0–#20), the defects and the quick wins.
