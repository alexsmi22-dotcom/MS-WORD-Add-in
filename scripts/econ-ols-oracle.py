"""Oracle for src/lib/olsInference.ts (Release E2): statsmodels 0.15 OLS under every standard-error type, plus the
diagnostics, on three public-domain textbook datasets bundled with statsmodels (longley, grunfeld, stackloss).

Run with the oracle venv:
  C:\\Users\\AlexanderSmith\\jurislab-oracle-venv\\Scripts\\python.exe scripts/econ-ols-oracle.py

Writes src/lib/__tests__/fixtures/{longley,grunfeld,stackloss}.csv and econ-ols-oracle.json. Every case passes
use_t=True so robust, clustered and HAC inference use the t reference (Stata's convention, the brief's).
"""
import json
import math
import os

import numpy as np
import statsmodels.api as sm
from statsmodels.stats.diagnostic import het_breuschpagan, het_white, linear_reset
from statsmodels.stats.outliers_influence import variance_inflation_factor
from statsmodels.stats.stattools import durbin_watson, jarque_bera

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "..", "src", "lib", "__tests__", "fixtures")


def write_csv(name, df):
    df.to_csv(os.path.join(FIX, name), index=False, lineterminator="\n")


def hac_default(n):
    return int(math.floor(4 * (n / 100) ** (2 / 9)))


def fit(y, X, cov, **kw):
    m = sm.OLS(y, X)
    if cov == "nonrobust":
        return m.fit()
    return m.fit(cov_type=cov, use_t=True, **kw)


def case(name, df, yname, xnames, cov, const=True, cluster=None, lag=None):
    y = df[yname].astype(float)
    X = df[xnames].astype(float)
    if const:
        X = sm.add_constant(X, prepend=False)
    kw = {}
    label = cov
    if cov == "cluster":
        codes = df[cluster].astype("category").cat.codes.values
        kw = {"cov_kwds": {"groups": codes, "use_correction": True, "df_correction": True}}
    elif cov == "HAC":
        kw = {"cov_kwds": {"maxlags": lag, "use_correction": True}}
    r = fit(y, X, cov, **kw)
    ci = np.asarray(r.conf_int())
    names = list(X.columns)
    out = {
        "name": name,
        "y": yname,
        "x": xnames,
        "const": const,
        "cov": label,
        "cluster": cluster,
        "lag": lag,
        "terms": [n if n != "const" else "Constant" for n in names],
        "params": list(map(float, r.params)),
        "bse": list(map(float, r.bse)),
        "tvalues": list(map(float, r.tvalues)),
        "pvalues": list(map(float, r.pvalues)),
        "ci_lo": list(map(float, ci[:, 0])),
        "ci_hi": list(map(float, ci[:, 1])),
        "rsquared": float(r.rsquared),
        "rsquared_adj": float(r.rsquared_adj),
        "fvalue": float(np.squeeze(r.fvalue)),
        "f_pvalue": float(np.squeeze(r.f_pvalue)),
        "df_resid": float(r.df_resid),
        "df_resid_inference": float(getattr(r, "df_resid_inference", None) or r.df_resid),
        "root_mse": float(np.sqrt(r.mse_resid)),
        "aic": float(r.aic),
        "bic": float(r.bic),
        "llf": float(r.llf),
        "nobs": int(r.nobs),
    }
    return out, r, X


def diagnostics(name, df, yname, xnames):
    y = df[yname].astype(float)
    X = sm.add_constant(df[xnames].astype(float), prepend=False)
    r = sm.OLS(y, X).fit()
    e = r.resid
    bp = het_breuschpagan(e, X, robust=True)
    out = {
        "name": name,
        "y": yname,
        "x": xnames,
        "dw": float(durbin_watson(e)),
        "bp_lm": float(bp[0]),
        "bp_p": float(bp[1]),
        "bp_df": int(X.shape[1] - 1),
    }
    k = X.shape[1]
    if k * (k + 1) / 2 < len(y):
        w = het_white(e, X)
        aux = sm.OLS(e ** 2, X.values[:, np.triu_indices(k)[0]] * X.values[:, np.triu_indices(k)[1]]).fit()
        out.update({"white_lm": float(w[0]), "white_p": float(w[1]), "white_df": float(aux.df_model)})
    out["vif"] = [float(variance_inflation_factor(X.values, j)) for j in range(len(xnames))]
    rs = linear_reset(r, power=3, test_type="fitted", use_f=True)
    out.update({"reset_f": float(rs.fvalue), "reset_p": float(rs.pvalue), "reset_df1": float(rs.df_num), "reset_df2": float(rs.df_denom)})
    # The same RESET with the fitted values standardised before they are raised to powers 2 and 3. With a constant
    # the column space (and so F) is unchanged; it only avoids the rank loss statsmodels' pinv suffers when the
    # fitted values are large (longley: fitted^3 ~ 2e14 makes the augmented design numerically rank 7 of 9, and
    # statsmodels then reports F(2, 8) = 6.949 instead of the true F(2, 7) = 2.273).
    f = r.fittedvalues
    z = (f - f.mean()) / f.std()
    ra = sm.OLS(y, np.column_stack([X.values, z ** 2, z ** 3])).fit()
    from scipy import stats as sps
    fs = ((r.ssr - ra.ssr) / 2) / (ra.ssr / ra.df_resid)
    out.update({"reset_scaled_f": float(fs), "reset_scaled_p": float(sps.f.sf(fs, 2, ra.df_resid)), "reset_scaled_df2": float(ra.df_resid)})
    jb = jarque_bera(e)
    out.update({"jb": float(jb[0]), "jb_p": float(jb[1]), "skew": float(jb[2]), "kurtosis": float(jb[3])})
    return out


def main():
    longley = sm.datasets.longley.load_pandas().data
    grunfeld = sm.datasets.grunfeld.load_pandas().data
    stack = sm.datasets.stackloss.load_pandas().data
    write_csv("longley.csv", longley)
    write_csv("grunfeld.csv", grunfeld)
    write_csv("stackloss.csv", stack)

    LX = ["GNPDEFL", "GNP", "UNEMP", "ARMED", "POP", "YEAR"]
    SX = ["AIRFLOW", "WATERTEMP", "ACIDCONC"]
    cases = []
    for cov in ["nonrobust", "HC0", "HC1", "HC2", "HC3"]:
        cases.append(case(f"longley {cov}", longley, "TOTEMP", LX, cov)[0])
        cases.append(case(f"stackloss {cov}", stack, "STACKLOSS", SX, cov)[0])
        cases.append(case(f"grunfeld {cov}", grunfeld, "invest", ["value", "capital"], cov)[0])
    cases.append(case("longley HAC default", longley, "TOTEMP", LX, "HAC", lag=hac_default(16))[0])
    cases.append(case("longley HAC 1", longley, "TOTEMP", LX, "HAC", lag=1)[0])
    cases.append(case("stackloss HAC 3", stack, "STACKLOSS", SX, "HAC", lag=3)[0])
    cases.append(case("grunfeld HAC default", grunfeld, "invest", ["value", "capital"], "HAC", lag=hac_default(220))[0])
    cases.append(case("grunfeld cluster firm", grunfeld, "invest", ["value", "capital"], "cluster", cluster="firm")[0])
    cases.append(case("grunfeld cluster year", grunfeld, "invest", ["value", "capital"], "cluster", cluster="year")[0])
    cases.append(case("stackloss no constant", stack, "STACKLOSS", SX, "nonrobust", const=False)[0])
    cases.append(case("stackloss no constant HC1", stack, "STACKLOSS", SX, "HC1", const=False)[0])

    diags = [
        diagnostics("longley", longley, "TOTEMP", LX),
        diagnostics("stackloss", stack, "STACKLOSS", SX),
        diagnostics("grunfeld", grunfeld, "invest", ["value", "capital"]),
    ]
    meta = {
        "generator": "scripts/econ-ols-oracle.py",
        "statsmodels": sm.__version__ if hasattr(sm, "__version__") else __import__("statsmodels").__version__,
        "hac_default": {"16": hac_default(16), "220": hac_default(220)},
    }
    with open(os.path.join(FIX, "econ-ols-oracle.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"meta": meta, "cases": cases, "diagnostics": diags}, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
