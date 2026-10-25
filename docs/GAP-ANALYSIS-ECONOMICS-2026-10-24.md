# Gap analysis: quantitative economics (2026-10-24, v2.194.0)

What JurisLab already has that economics can stand on: a full TVM/NPV/IRR/XIRR/bond/option Finance mode; OLS
(simple, multiple via QR, polynomial) with SE/t/p/R²/F; ANOVA, nonparametric, survival and Cox; exact LP with duals
and sensitivity; Lagrange multipliers, Hessians and critical points; matrix inverse, eigen and SVD; linear
recurrences with closed forms; ODEs; nonlinear curve fitting; Markov chains; table import from Word, CSV and Excel;
column/line/scatter/candlestick charts.

What it has none of: robust or clustered standard errors, logit/probit, IV, panel models, any time-series model or
test, index numbers or inflation adjustment, inequality or concentration measures, supply/demand or welfare,
macro models, game theory, and nothing for litigation damages (royalties, lost profits, prejudgment interest).

## Ranked gaps

Ranked by value to the people using JurisLab: a patent and litigation practice first, then the economics students
and researchers who are the real inbound audience.

| # | Gap | What it would do | Why this rank |
|---|-----|------------------|---------------|
| 1 | **Patent damages** | Reasonable royalty (base × rate, running vs lump sum, apportionment, a Georgia-Pacific worksheet table); lost profits (Panduit factors, incremental margin, market-share method); price erosion; a damages summary table by period | 35 U.S.C. § 284 is the firm's own domain; nothing like it exists in Word |
| 2 | **Prejudgment and post-judgment interest** | Simple or compounded (annual, quarterly, daily) on a damages stream, by period, with the rate table you supply (prime, T-bill, state statutory rate); 28 U.S.C. § 1961 post-judgment form | Needed in every damages report; easy to get wrong by hand |
| 3 | **Regression you can publish** | Robust (HC0–HC3), clustered and Newey–West SEs; diagnostics (Durbin–Watson, Breusch–Pagan, White, VIF, RESET, Jarque–Bera); logit/probit by maximum likelihood with marginal effects; a journal-style regression table (SEs in parentheses, stars, N, R²) | The single most-used tool in applied economics; builds on the existing OLS |
| 4 | **Time series** | ACF/PACF with bands, Ljung–Box, ADF and KPSS unit-root tests, ARIMA fit and forecast with intervals, Holt–Winters smoothing, HP filter | No time-series capability at all today |
| 5 | **Inflation and index numbers** | Laspeyres, Paasche, Fisher, chained indexes; deflate a money series to constant dollars with a CPI series (bundled BLS CPI-U annual, public domain, or your own) | Damages, wages and student work all need constant dollars |
| 6 | **Causal inference** | IV / 2SLS with first-stage F; panel fixed and random effects with Hausman; difference-in-differences and an event-study figure | Core graduate econometrics |
| 7 | **Inequality and market concentration** | Gini, Lorenz curve figure, Theil, Atkinson; HHI and ΔHHI against the 2023 Merger Guidelines thresholds | Antitrust and policy work; small to build |
| 8 | **Microeconomics** | Supply–demand equilibrium, elasticities, consumer and producer surplus, deadweight loss and tax incidence with the standard figure; monopoly, Cournot and Bertrand | Teaching staple; figures are the value |
| 9 | **Securities event study** | Market-model abnormal returns, CAR with t-tests, event-window figure | Securities-litigation damages |
| 10 | **Lost earnings (personal injury)** | Present value of lost earnings: growth, discount, worklife, personal-consumption offset, year-by-year table | Forensic economics |
| 11 | **Game theory** | Pure and mixed Nash equilibria of two-player games, dominance, best-response figure | Small engine, clear output |
| 12 | **Macro models** | Solow growth simulation, IS–LM and AD–AS figures, Keynesian multiplier, Taylor rule | Teaching |
| 13 | **Input–output (Leontief)** | (I − A)⁻¹, output and employment multipliers, backward and forward linkages | Thin wrapper on existing linear algebra |
| 14 | **Bootstrap and quantile regression** | Bootstrap CIs for any statistic; quantile regression | Robustness checks |
| 15 | **Currency** | Currency as a unit with your own rates (no live rates: JurisLab is offline) | Convenience |

Quick wins (a day or less each): #13 Leontief, #7 Gini/HHI, #15 currency, the Durbin–Watson and VIF parts of #3.
