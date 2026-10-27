"""
Oracle for Release F2 item #10, Time series II (src/lib/ts2.ts, src/lib/ts2StatCalcs.ts):
  - GARCH(1,1), GJR-GARCH(1,1,1), EGARCH(1,1,1) by maximum likelihood (arch 8.0, arch_model);
  - VAR(p): select_order, fit, test_causality (F), orthogonalised IRFs with asymptotic SEs, FEVD (statsmodels 0.15);
  - Engle-Granger cointegration (statsmodels coint) and Johansen trace / max-eigenvalue (coint_johansen).

All data are synthetic, generated here with fixed seeds (numpy default_rng) and ROUNDED to the decimals the default
text prints, and every model is fitted on the rounded values, so the engine run on the default text is exactly the
oracle case. Doubles go to the JSON with Python's repr (round-trips exactly).

arch conventions pinned: rescale=False; mean 'Constant' or 'Zero'; GJR is vol='GARCH', p=1, o=1, q=1; EGARCH is
vol='EGARCH', p=1, o=1, q=1 (arch's EGARCH default o=0 has no asymmetry term); dist 'normal' or 't'. The fit is run with
a tight tolerance (tol=1e-12, maxiter=2000) so the reference is the optimum rather than SLSQP's default stop. Recorded
per case: params, loglikelihood, robust (Bollerslev-Wooldridge) and classic SEs, the backcast, the conditional
volatility, and the analytic variance forecasts (EGARCH: h = 1 only; arch refuses analytic forecasts beyond 1). Also
recorded at FIXED parameters (the data-generating values): the llf and compute_param_cov(robust=True/False), so the
likelihood and the covariance formula are tested apart from the optimiser.

The 'holdout' block holds cases the engine was NOT tuned on (the adversarial pass checks them).

The MacKinnon (1994, 2010) cointegration tables for N = 1..6 and the Osterwald-Lenum tables (statsmodels
coint_tables c_sja / c_sjt) are written as `tables` so jest checks the copies in ts2.ts entry by entry.

Run: jurislab-oracle-venv python -I scripts/ts2-oracle.py
(writes src/lib/__tests__/fixtures/ts2-oracle.json; with --ts also prints the default-data TS literals)
"""
import json, math, os, sys, warnings
import numpy as np

warnings.filterwarnings("ignore")
from arch import arch_model
import arch
import statsmodels
from statsmodels.tsa.api import VAR
from statsmodels.tsa.stattools import coint
from statsmodels.tsa.vector_ar.vecm import coint_johansen
from statsmodels.tsa import adfvalues, coint_tables

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "lib", "__tests__", "fixtures", "ts2-oracle.json")


def L(a):
    return [float(v) for v in np.asarray(a, dtype=float).ravel()]


# ------------------------------------------------------------------ data

def sim_gjr_t(n, seed, mu, omega, alpha, gamma, beta, nu, burn=500):
    rng = np.random.default_rng(seed)
    z = rng.standard_t(nu, n + burn) * math.sqrt((nu - 2) / nu)
    e = np.zeros(n + burn)
    s2 = np.zeros(n + burn)
    s2[0] = omega / (1 - alpha - gamma / 2 - beta)
    e[0] = math.sqrt(s2[0]) * z[0]
    for t in range(1, n + burn):
        s2[t] = omega + (alpha + gamma * (e[t - 1] < 0)) * e[t - 1] ** 2 + beta * s2[t - 1]
        e[t] = math.sqrt(s2[t]) * z[t]
    return np.round(mu + e[burn:], 3)


def sim_var(n, seed, A, c, chol, burn=200, dec=2):
    rng = np.random.default_rng(seed)
    k = len(c)
    p = len(A)
    y = np.zeros((n + burn, k))
    for t in range(p, n + burn):
        v = np.array(c, dtype=float)
        for j in range(p):
            v = v + np.asarray(A[j]) @ y[t - 1 - j]
        y[t] = v + np.asarray(chol) @ rng.standard_normal(k)
    return np.round(y[burn:], dec)


def sim_coint(n, seed, k, dec=2):
    """k I(1) series: x_2..x_k random walks with drift, y = 1 + 0.8 x_2 - 0.5 x_3 + stationary AR(1) error."""
    rng = np.random.default_rng(seed)
    X = np.cumsum(0.1 + rng.standard_normal((n, k - 1)), axis=0) + 50
    u = np.zeros(n)
    for t in range(1, n):
        u[t] = 0.6 * u[t - 1] + rng.standard_normal()
    b = [0.8, -0.5, 0.3, 0.2, -0.1][: k - 1]
    y = 1 + X @ np.array(b) + u
    return np.round(np.column_stack([y, X]), dec)


# GARCH default: 500 daily returns in %, GJR-GARCH(1,1,1) with Student-t(7) errors.
GARCH_TRUE = dict(mu=0.05, omega=0.03, alpha=0.04, gamma=0.08, beta=0.88, nu=7.0)
garch_y = sim_gjr_t(500, 20261027, **GARCH_TRUE)
# Holdout: plain GARCH(1,1) normal-ish, 800 obs.
garch_hold = sim_gjr_t(800, 777, mu=-0.02, omega=0.08, alpha=0.10, gamma=0.0, beta=0.85, nu=30.0)

# VAR default: 3 quarterly series 1996 Q1 - 2025 Q4 (120 obs), stationary VAR(2).
VAR_A = [
    [[0.45, 0.10, -0.15], [0.05, 0.55, 0.05], [0.10, 0.20, 0.70]],
    [[0.15, 0.00, -0.05], [0.00, 0.15, 0.00], [0.00, 0.05, 0.10]],
]
VAR_C = [1.0, 0.6, 0.3]
VAR_CHOL = [[0.8, 0, 0], [0.2, 0.4, 0], [0.1, 0.15, 0.3]]
var_y = sim_var(120, 1996, VAR_A, VAR_C, VAR_CHOL)
VAR_NAMES = ["Growth", "Inflation", "Rate"]
var_hold2 = sim_var(150, 4242, [[[0.5, 0.2], [-0.1, 0.6]]], [0.2, -0.1], [[1.0, 0], [0.3, 0.7]], dec=3)
var_hold4 = sim_var(200, 99, [np.diag([0.5, 0.3, 0.6, 0.2]) + 0.05], [0, 1, 2, 3], np.eye(4) * 0.5 + 0.1 * np.tril(np.ones((4, 4)), -1), dec=3)

# Cointegration default: 3 monthly series, 180 obs.
coint_y = sim_coint(180, 2009, 3)
COINT_NAMES = ["Y", "X1", "X2"]
coint_hold2 = sim_coint(250, 31337, 2, dec=3)
coint_hold4 = sim_coint(300, 8080, 4, dec=3)


# ------------------------------------------------------------------ GARCH

def garch_case(y, vol, dist, mean, horizon=10, fixed=None):
    if vol == "garch":
        am = arch_model(y, mean=mean, vol="GARCH", p=1, o=0, q=1, dist=dist, rescale=False)
    elif vol == "gjr":
        am = arch_model(y, mean=mean, vol="GARCH", p=1, o=1, q=1, dist=dist, rescale=False)
    else:
        am = arch_model(y, mean=mean, vol="EGARCH", p=1, o=1, q=1, dist=dist, rescale=False)
    res = am.fit(disp="off", tol=1e-12, options={"maxiter": 2000})
    params = res.params.values
    rob = am.compute_param_cov(params, robust=True)
    cls = am.compute_param_cov(params, robust=False)
    h = horizon if vol != "egarch" else 1
    fc = res.forecast(horizon=h, reindex=False).variance.values[-1]
    out = {
        "vol": vol, "dist": dist, "mean": mean,
        "names": list(res.params.index),
        "params": L(params),
        "llf": float(res.loglikelihood),
        "seRobust": L(np.sqrt(np.diag(rob))),
        "seClassic": L(np.sqrt(np.diag(cls))),
        "backcast": float(am._backcast) if np.ndim(am._backcast) == 0 else L(am._backcast),
        "condVol": L(res.conditional_volatility),
        "varForecast": L(fc),
        "converged": int(res.convergence_flag),
    }
    if fixed is not None:
        fp = np.asarray(fixed, dtype=float)
        fres = am.fix(fp)
        out["fixedParams"] = L(fp)
        out["fixedLlf"] = float(fres.loglikelihood)
        out["fixedCovRobust"] = L(am.compute_param_cov(fp, robust=True))
        out["fixedCovClassic"] = L(am.compute_param_cov(fp, robust=False))
    return out


def fixed_for(vol, dist, mean):
    t = GARCH_TRUE
    m = [t["mu"]] if mean == "Constant" else []
    if vol == "garch":
        v = [t["omega"], t["alpha"] + t["gamma"] / 2, t["beta"]]
    elif vol == "gjr":
        v = [t["omega"], t["alpha"], t["gamma"], t["beta"]]
    else:
        v = [0.0, 0.15, -0.06, 0.96]
    d = [t["nu"]] if dist == "t" else []
    return m + v + d


garch_cases = []
for vol in ("garch", "gjr", "egarch"):
    for dist in ("normal", "t"):
        garch_cases.append(garch_case(garch_y, vol, dist, "Constant", fixed=fixed_for(vol, dist, "Constant")))
garch_cases.append(garch_case(garch_y, "garch", "normal", "Zero", fixed=fixed_for("garch", "normal", "Zero")))
garch_cases.append(garch_case(garch_y, "gjr", "t", "Zero"))
garch_holdout = [
    garch_case(garch_hold, "garch", "normal", "Constant"),
    garch_case(garch_hold, "gjr", "normal", "Constant"),
    garch_case(garch_hold, "egarch", "t", "Constant"),
    garch_case(garch_hold, "garch", "t", "Zero"),
]


# ------------------------------------------------------------------ VAR

def var_case(Y, names, p, maxlags, periods=10):
    import pandas as pd
    df = pd.DataFrame(Y, columns=names)
    model = VAR(df)
    so = model.select_order(maxlags=maxlags, trend="c")
    if p is None:
        p = int(so.selected_orders["aic"])
    res = model.fit(p, trend="c")
    k = len(names)
    causal = []
    for i in range(k):
        for j in range(k):
            if i == j:
                continue
            t = res.test_causality(names[i], [names[j]], kind="f")
            causal.append({"caused": names[i], "causing": names[j], "F": float(t.test_statistic),
                           "df1": int(t.df[0]), "df2": int(t.df[1]), "p": float(t.pvalue)})
    irf = res.irf(periods)
    fevd = res.fevd(periods)
    return {
        "names": names, "p": p, "maxlags": maxlags, "periods": periods,
        "ics": {kk: L(v) for kk, v in so.ics.items()},
        "selected": {kk: int(v) for kk, v in so.selected_orders.items()},
        "params": L(res.params.values),          # (1 + K p) x K, row-major
        "stderr": L(res.stderr.values),
        "sigmaU": L(res.sigma_u),
        "nobs": int(res.nobs),
        "llf": float(res.llf),
        "aic": float(res.aic), "bic": float(res.bic), "hqic": float(res.hqic), "fpe": float(res.fpe),
        "causality": causal,
        "orthIrf": L(irf.orth_irfs),              # (periods + 1) x K x K
        "orthIrfSe": L(irf.stderr(orth=True)),
        "fevd": L(fevd.decomp),                   # K x periods x K
        "stable": bool(res.is_stable()),
    }


var_default = var_case(var_y, VAR_NAMES, None, 8)
var_holdout = [
    var_case(var_hold2, ["A", "B"], 1, 6, periods=8),
    var_case(var_hold4, ["W", "X", "Y", "Z"], 1, 4, periods=6),
    var_case(var_y, VAR_NAMES, 2, 8, periods=12),
    var_case(var_y, VAR_NAMES, 4, 6, periods=12),
]


# ------------------------------------------------------------------ cointegration

def eg_case(Y, trend):
    r = coint(Y[:, 0], Y[:, 1:], trend=trend, autolag="aic")
    return {"trend": trend, "k": int(Y.shape[1]), "stat": float(r[0]), "p": float(r[1]), "crit": L(r[2])}


def joh_case(Y, det, kdiff):
    r = coint_johansen(Y, det, kdiff)
    return {"det": det, "kdiff": kdiff, "eig": L(r.eig), "trace": L(r.lr1), "maxEig": L(r.lr2),
            "cvt": L(r.cvt), "cvm": L(r.cvm)}


eg_default = [eg_case(coint_y, "c"), eg_case(coint_y, "ct")]
eg_holdout = [eg_case(coint_hold2, "c"), eg_case(coint_hold2, "ct"), eg_case(coint_hold4, "c")]
joh_default = [joh_case(coint_y, d, k) for d in (-1, 0, 1) for k in (1, 2)]
joh_holdout = [joh_case(coint_hold2, 0, 1), joh_case(coint_hold4, 1, 3), joh_case(coint_hold4, -1, 0)]


# ------------------------------------------------------------------ tables

def mk(reg):
    return {
        "tauStar": L(adfvalues._tau_stars[reg][:6]),
        "tauMin": L(adfvalues._tau_mins[reg][:6]),
        "tauMax": [float(v) if np.isfinite(v) else 1e308 for v in adfvalues._tau_maxs[reg][:6]],
        "smallp": [L(r) for r in adfvalues._tau_smallps[reg][:6]],
        "largep": [L(r) for r in adfvalues._tau_largeps[reg][:6]],
        "crit2010": [[L(row) for row in adfvalues.tau_2010s[reg][n]] for n in range(6)],
    }


tables = {
    "mackinnon": {"c": mk("c"), "ct": mk("ct")},
    "sja": {str(d): [L(coint_tables.c_sja(n, d)) for n in range(1, 13)] for d in (-1, 0, 1)},
    "sjt": {str(d): [L(coint_tables.c_sjt(n, d)) for n in range(1, 13)] for d in (-1, 0, 1)},
}

fixture = {
    "versions": {"arch": arch.__version__, "statsmodels": statsmodels.__version__, "numpy": np.__version__},
    "data": {
        "garch": L(garch_y), "garchHold": L(garch_hold),
        "var": [L(r) for r in var_y], "varHold2": [L(r) for r in var_hold2], "varHold4": [L(r) for r in var_hold4],
        "coint": [L(r) for r in coint_y], "cointHold2": [L(r) for r in coint_hold2], "cointHold4": [L(r) for r in coint_hold4],
    },
    "garch": garch_cases,
    "garchHoldout": garch_holdout,
    "var": var_default,
    "varHoldout": var_holdout,
    "eg": eg_default,
    "egHoldout": eg_holdout,
    "johansen": joh_default,
    "johansenHoldout": joh_holdout,
    "tables": tables,
}
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(fixture, fh, indent=1)
print("wrote", os.path.normpath(OUT))

if "--ts" in sys.argv:
    def fmt(v, d):
        return f"{v:.{d}f}"
    print("GARCH_ROWS")
    vals = [fmt(v, 3) for v in garch_y]
    for i in range(0, len(vals), 20):
        print("  " + ", ".join(f'"{s}"' for s in vals[i:i + 20]) + ",")
    print("VAR_ROWS")
    rows = []
    for i, r in enumerate(var_y):
        yr, qq = 1996 + i // 4, i % 4 + 1
        rows.append(f'"{yr}-Q{qq} ' + " ".join(fmt(v, 2) for v in r) + '"')
    for i in range(0, len(rows), 6):
        print("  " + ", ".join(rows[i:i + 6]) + ",")
    print("COINT_ROWS")
    rows = []
    for i, r in enumerate(coint_y):
        yr, mm = 2011 + i // 12, i % 12 + 1
        rows.append(f'"{yr}-{mm:02d} ' + " ".join(fmt(v, 2) for v in r) + '"')
    for i in range(0, len(rows), 6):
        print("  " + ", ".join(rows[i:i + 6]) + ",")
