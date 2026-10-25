"""
Oracle for Release E3a (time-series diagnostics): statsmodels 0.15 itself, on synthetic series from fixed seeds.

  acf(x, adjusted=False, nlags=K, alpha=0.05)          ACF and Bartlett 95% bands
  pacf(x, nlags=K, alpha=0.05)                          default method "ywadjusted"
  acorr_ljungbox(x, lags=K, model_df=m)                 Q and p per lag
  adfuller(x, maxlag, regression, autolag="AIC"|None)   statistic, p, used lag, nobs, critical values, icbest
  kpss(x, regression, nlags="auto"|k)                   statistic, p, lags
  hpfilter(x, lamb)                                     trend and cycle
  mackinnonp / mackinnoncrit                            on a grid of statistics and sample sizes

It also writes the shipped default table (quarterly, 1995-Q1 to 2024-Q4: "Output", a random walk with drift and AR(1)
innovations; "Spread", a stationary AR(1)), rounded to 2 decimals, and computes on the values exactly as printed. The
MacKinnon tables are extracted twice: the raw literals from adfvalues.py's source (ast), and the scaled arrays the
module holds after import; jest checks tsDiag.ts against both.

Run: C:\\Users\\AlexanderSmith\\jurislab-oracle-venv\\Scripts\\python.exe scripts/ts-diag-oracle.py
(writes src/lib/__tests__/fixtures/ts-diag-oracle.json)
"""
import ast
import json
import math
import os
import warnings

import numpy as np
import statsmodels
import statsmodels.tsa.adfvalues as adfv
from statsmodels.stats.diagnostic import acorr_ljungbox
from statsmodels.tsa.filters.hp_filter import hpfilter
from statsmodels.tsa.stattools import acf, adfuller, kpss, pacf

warnings.simplefilter("ignore")
assert statsmodels.__version__.startswith("0.15"), statsmodels.__version__

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "__tests__", "fixtures", "ts-diag-oracle.json")


def fl(a):
    return [float(v) for v in np.asarray(a, dtype=float)]


def default_table():
    rng = np.random.default_rng(20261029)
    lev, ua, sp = 100.0, 0.0, 1.5
    rows = ["Quarter Output Spread"]
    out, spread = [], []
    for t in range(120):
        ua = 0.4 * ua + rng.normal(0, 0.8)
        lev = lev + 0.6 + ua
        sp = 1.5 + 0.6 * (sp - 1.5) + rng.normal(0, 0.35)
        q = f"{1995 + t // 4}-Q{t % 4 + 1}"
        a, b = f"{lev:.2f}", f"{sp:.2f}"
        rows.append(f"{q} {a} {b}")
        out.append(float(a))
        spread.append(float(b))
    return "\n".join(rows), out, spread


def ar1(n, phi, seed, scale=1.0, mu=0.0):
    rng = np.random.default_rng(seed)
    x = np.zeros(n)
    prev = 0.0
    for t in range(n):
        prev = phi * prev + rng.normal()
        x[t] = mu + scale * prev
    return x


def ma1(n, theta, seed):
    rng = np.random.default_rng(seed)
    e = rng.normal(size=n + 1)
    return e[1:] + theta * e[:-1]


def rw(n, seed, drift=0.0):
    rng = np.random.default_rng(seed)
    return np.cumsum(drift + rng.normal(size=n))


table, OUTPUT, SPREAD = default_table()

# --- ACF / PACF / Ljung–Box ---------------------------------------------------------------------------------------
acf_cases = []


def acf_case(name, x, K, model_df):
    x = np.asarray(x, dtype=float)
    r, ci = acf(x, adjusted=False, nlags=K, alpha=0.05, result_object=False)
    pr = pacf(x, nlags=K, alpha=0.05)
    lb = acorr_ljungbox(x, lags=K, model_df=model_df)
    acf_cases.append(
        {
            "name": name,
            "x": fl(x),
            "K": K,
            "modelDf": model_df,
            "acf": fl(r),
            "band": fl(r - ci[:, 0]),
            "pacf": fl(pr.pacf),
            "pacfBand": float(pr.pacf[1] - pr.confint[1, 0]),
            "q": fl(lb["lb_stat"]),
            "p": [None if math.isnan(v) else float(v) for v in lb["lb_pvalue"]],
        }
    )


n_sp = len(SPREAD)
acf_case("default Spread, default lags", SPREAD, max(min(int(10 * np.log10(n_sp)), n_sp // 2 - 1), 1), 0)
acf_case("MA(1) theta 0.7, n 60, 12 lags, model df 2", ma1(60, 0.7, 11), 12, 2)
acf_case("AR(1) phi 0.98, n 400, 30 lags, scale 1e-12", ar1(400, 0.98, 12, scale=1e-12), 30, 0)
acf_case("white noise x 1e12, n 100, 20 lags, model df 3", np.random.default_rng(13).normal(size=100) * 1e12, 20, 3)

default_lags = []
for n in [10, 11, 20, 99, 100, 101, 999, 1000, 1001, 9999, 10000, 10001, 100000]:
    default_lags.append(
        {
            "n": n,
            "acf": min(int(10 * np.log10(n)), n - 1),
            "pacf": max(min(int(10 * np.log10(n)), n // 2 - 1), 1),
            "lb": min(10, n // 5),
        }
    )

# --- ADF ----------------------------------------------------------------------------------------------------------
adf_cases = []


def adf_case(name, x, regression, maxlag, autolag):
    x = np.asarray(x, dtype=float)
    res = adfuller(x, maxlag=maxlag, regression=regression, autolag=autolag, result_object=True)
    adf_cases.append(
        {
            "name": name,
            "x": fl(x),
            "regression": regression,
            "maxlag": maxlag,
            "autolag": autolag is not None,
            "stat": float(res.statistic),
            "p": float(res.pvalue),
            "usedLag": int(res.lags),
            "nobs": int(res.nobs),
            "crit": [float(res.critical_values[k]) for k in ("1%", "5%", "10%")],
            "icbest": None if res.icbest is None else float(res.icbest),
        }
    )


adf_case("default Output, constant, AIC", OUTPUT, "c", None, "AIC")
adf_case("default Output, constant + trend, AIC", OUTPUT, "ct", None, "AIC")
adf_case("default Spread, none, AIC", SPREAD, "n", None, "AIC")
adf_case("default Spread, constant, AIC", SPREAD, "c", None, "AIC")
adf_case("random walk n 250, constant + trend, fixed lag 3", rw(250, 21, 0.2), "ct", 3, None)
adf_case("AR(2) n 200, constant, AIC up to 5", np.convolve(np.random.default_rng(22).normal(size=202), [1, 0.5, 0.3], "valid") , "c", 5, "AIC")
adf_case("AR(1) phi 0.9 n 1600 (Schwert boundary), constant, AIC", ar1(1600, 0.9, 23, mu=5), "c", None, "AIC")
adf_case("random walk x 1e-12, n 150, none, fixed lag 0", rw(150, 24) * 1e-12, "n", 0, None)

adf_maxlag = []
for n in [10, 12, 20, 99, 100, 101, 1599, 1600, 1601, 8099, 8100, 8101, 100000]:
    row = {"nobs": n}
    for reg in ("n", "c", "ct"):
        ntrend = len(reg) if reg != "n" else 0
        ml = int(np.ceil(12.0 * np.power(n / 100.0, 1 / 4.0)))
        row[reg] = min(n // 2 - ntrend - 1, ml)
    adf_maxlag.append(row)

# --- KPSS ---------------------------------------------------------------------------------------------------------
kpss_cases = []


def kpss_case(name, x, regression, nlags):
    x = np.asarray(x, dtype=float)
    res = kpss(x, regression=regression, nlags=nlags, result_object=True)
    kpss_cases.append(
        {
            "name": name,
            "x": fl(x),
            "regression": regression,
            "nlags": nlags,
            "stat": float(res.statistic),
            "p": float(res.pvalue),
            "lags": int(res.lags),
        }
    )


kpss_case("default Output, constant, auto", OUTPUT, "c", "auto")
kpss_case("default Output, constant + trend, auto", OUTPUT, "ct", "auto")
kpss_case("default Spread, constant, auto", SPREAD, "c", "auto")
kpss_case("default Spread, constant, 4 lags", SPREAD, "c", 4)
kpss_case("AR(1) phi 0.5 n 512 (covlags boundary), constant + trend, auto", ar1(512, 0.5, 31), "ct", "auto")
kpss_case("AR(1) phi 0.3 n 19683 (covlags boundary), constant, auto", ar1(19683, 0.3, 32), "c", "auto")
# A statistic inside the table (interpolated p), found by seed search below.
for seed in range(100, 400):
    x = ar1(200, 0.85, seed)
    r = kpss(x, regression="c", nlags="auto", result_object=True)
    if 0.36 < r.statistic < 0.72:
        kpss_case(f"AR(1) phi 0.85 n 200 seed {seed}, interpolated p", x, "c", "auto")
        break
kpss_case("trend + noise x 1e12, n 90, constant + trend, auto", (np.arange(90) * 0.3 + np.random.default_rng(33).normal(size=90)) * 1e12, "ct", "auto")

# --- HP -----------------------------------------------------------------------------------------------------------
hp_cases = []


def hp_case(name, x, lamb):
    x = np.asarray(x, dtype=float)
    cycle, trend = hpfilter(x, lamb)
    hp_cases.append({"name": name, "x": fl(x), "lambda": lamb, "trend": fl(trend), "cycle": fl(cycle)})


hp_case("default Output, quarterly 1600", OUTPUT, 1600)
annual = rw(40, 41, 1.0) + 50
hp_case("annual n 40, Ravn-Uhlig 6.25", annual, 6.25)
hp_case("annual n 40, 100", annual, 100)
monthly = rw(300, 42, 0.1) + 3 * np.sin(np.arange(300) / 9)
hp_case("monthly n 300, Ravn-Uhlig 129600", monthly, 129600)
hp_case("monthly n 300, 14400", monthly, 14400)
hp_case("quarterly x 1e12, n 80, 1600", (rw(80, 43, 0.5) + 100) * 1e12, 1600)
hp_case("n 4, 1600", [1.0, 3.0, 2.0, 5.0], 1600)

# --- MacKinnon ----------------------------------------------------------------------------------------------------
mk_p = []
for reg in ("n", "c", "ct"):
    for tau in np.round(np.arange(-20.5, 3.01, 0.37), 6):
        mk_p.append({"reg": reg, "tau": float(tau), "p": float(adfv.mackinnonp(float(tau), regression=reg, N=1))})
    for tau in (adfv._tau_stars[reg][0], adfv._tau_mins[reg][0], adfv._tau_maxs[reg][0] if reg != "n" else 5.0):
        mk_p.append({"reg": reg, "tau": float(tau), "p": float(adfv.mackinnonp(float(tau), regression=reg, N=1))})
mk_crit = []
for reg in ("n", "c", "ct"):
    for nobs in (10, 25, 50, 100, 118, 500, 10000):
        mk_crit.append({"reg": reg, "nobs": nobs, "crit": fl(adfv.mackinnoncrit(N=1, regression=reg, nobs=nobs))})

# Raw literals from the source, and the scaled arrays after import.
src = open(adfv.__file__, encoding="utf-8").read()
tree = ast.parse(src)
raw = {}
for node in tree.body:
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        nm = node.targets[0].id
        if isinstance(node.value, ast.List):
            raw[nm] = ast.literal_eval(ast.unparse(node.value).replace("inf", "None"))


tables = {}
for reg, tag in (("n", "nc"), ("c", "c"), ("ct", "ct")):
    tables[reg] = {
        "tauStar": raw[f"tau_star_{tag}"][0],
        "tauMin": raw[f"tau_min_{tag}"][0],
        "tauMax": raw[f"tau_max_{tag}"][0],  # None stands for inf
        "smallp": raw[f"tau_{tag}_smallp"][0],
        "largep": raw[f"tau_{tag}_largep"][0],
        "crit2010": raw[f"tau_{tag}_2010"][0],
        "smallpScaled": fl(adfv._tau_smallps[reg][0]),
        "largepScaled": fl(adfv._tau_largeps[reg][0]),
    }

fixture = {
    "statsmodels": statsmodels.__version__,
    "numpy": np.__version__,
    "defaultTable": table,
    "acf": acf_cases,
    "defaultLags": default_lags,
    "adf": adf_cases,
    "adfMaxlag": adf_maxlag,
    "kpss": kpss_cases,
    "hp": hp_cases,
    "mackinnonP": mk_p,
    "mackinnonCrit": mk_crit,
    "mackinnonTables": tables,
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(fixture, f, allow_nan=False)
print("wrote", OUT)
print(table.split("\n")[0], "...", len(table.split("\n")) - 1, "rows")
for c in adf_cases:
    print("adf", c["name"], c["stat"], c["usedLag"], c["nobs"])
for c in kpss_cases:
    print("kpss", c["name"], c["stat"], c["p"], c["lags"])
