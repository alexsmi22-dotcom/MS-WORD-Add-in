"""
Oracle for the iv-2sls calculator (Release E4a): linearmodels 7.1 IV2SLS on synthetic data.

Conventions read from linearmodels' source (iv/model.py fit(), iv/covariance.py, iv/results.py):
  - fit(cov_type="robust", debiased=False) is the default: HC0 with no n/(n-k), z statistics, normal intervals.
  - debiased=True: s2 = e'e/(n-k), robust scaled n/(n-k) (HC1), clustered scaled G/(G-1)(n-1)/(n-k), t(n-k).
  - clustered with debiased=False: NO finite-sample factor (ClusteredCovariance.s rescale returns s unchanged).
  - first_stage.diagnostics f.stat: unadjusted -> Wald/q, F(q, df_resid) (n/(n-k) times the textbook F unless
    debiased); robust/clustered -> the undivided Wald, chi2(q).
The calculator crosses HC0/HC1 with the t/z select. linearmodels only pairs HC0 with z and HC1 with t, so for the
crossed cells this script takes the covariance from the matching linearmodels fit (HC0 = robust debiased=False,
HC1 = robust debiased=True) and computes p-values and intervals from the other reference with scipy.

Data: synthetic only (numpy default_rng with fixed seeds; the default table is the calculator's own 32-bit LCG,
ported exactly). No bundled example dataset is used.

Run: jurislab-oracle-venv python scripts/econ-iv-oracle.py  (writes src/lib/__tests__/fixtures/econ-iv-oracle.json)
"""
import json, math, os
import numpy as np
import pandas as pd
from scipy import stats
from linearmodels.iv import IV2SLS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "__tests__", "fixtures", "econ-iv-oracle.json")


# --------------------------------------------------------------------------------------------- the default table
def lcg_default():
    """Port of ivCalcs.ts ivDefaultTable(): 32-bit LCG (Numerical Recipes constants), sum of 12 uniforms - 6."""
    state = [20261025]

    def u():
        state[0] = (state[0] * 1664525 + 1013904223) & 0xFFFFFFFF
        return (state[0] + 0.5) / 4294967296.0

    def gauss():
        s = 0.0
        for _ in range(12):
            s += u()
        return s - 6.0

    def fmt(k, d):
        sign = "-" if k < 0 else ""
        a = abs(k)
        if d == 0:
            return sign + str(a)
        p = 10 ** d
        return sign + str(a // p) + "." + str(a % p).rjust(d, "0")

    lines = ["lwage\teduc\texper\tdist\tsibs"]
    for _ in range(200):
        exper = 1 + math.floor(u() * 25)
        dist_t = math.floor(u() * 500)
        sibs = math.floor(u() * 7)
        ability = gauss()
        v = gauss()
        w = gauss()
        educ_x = 13.0 - 0.008 * dist_t - 0.4 * sibs + 0.8 * ability + 0.8 * v
        educ_k = math.floor(educ_x * 10 + 0.5)
        lw_x = 0.8 + 0.009 * educ_k + 0.025 * exper + 0.25 * ability + 0.3 * w
        lw_k = math.floor(lw_x * 1000 + 0.5)
        lines.append("\t".join([fmt(lw_k, 3), fmt(educ_k, 1), str(exper), fmt(dist_t, 1), str(sibs)]))
    return "\n".join(lines)


def table_text(df, na_rows=None):
    na_rows = na_rows or {}
    lines = ["\t".join(df.columns)]
    for i in range(len(df)):
        cells = []
        for c in df.columns:
            if (i, c) in na_rows:
                cells.append("NA")
            else:
                v = df[c].iloc[i]
                cells.append(v if isinstance(v, str) else repr(float(v)))
        lines.append("\t".join(cells))
    return "\n".join(lines)


def read_table(text):
    rows = [l.split("\t") for l in text.split("\n")]
    df = pd.DataFrame(rows[1:], columns=rows[0])
    for c in df.columns:
        try:
            df[c] = df[c].astype(float)
        except ValueError:
            pass
    return df


# --------------------------------------------------------------------------------------------- the runs
def run(df, dep, exog, endog, instr, const, se, small, cluster=None, shift=None):
    """shift {col: c}: fit on col - c (exact by Sterbenz's lemma for values within a factor 2 of c), then map the
    intercept back: b0 = b0' - c*b_col, var(b0) = V00' + c^2 V_cc - 2c V_0c. Only the intercept changes; it keeps
    linearmodels' raw-data pinv/inv away from a condition number ~10^12 that costs it ~5 digits (see main())."""
    d = df.copy()
    shift = shift or {}
    for col, cval in shift.items():
        d[col] = d[col].astype(float) - cval
    exog_df = d[exog].astype(float) if exog else pd.DataFrame(index=d.index)
    if const:
        exog_df = exog_df.copy()
        exog_df["Constant"] = 1.0
    exog_arg = exog_df if exog_df.shape[1] else None
    mod = IV2SLS(d[dep].astype(float), exog_arg, d[endog].astype(float), d[instr].astype(float))
    clusters = None
    if cluster:
        clusters = pd.Series(pd.Categorical(d[cluster].astype(str)).codes, index=d.index)
    if se == "classical":
        res = mod.fit(cov_type="unadjusted", debiased=small)
    elif se == "hc0":
        res = mod.fit(cov_type="robust", debiased=False)
    elif se == "hc1":
        res = mod.fit(cov_type="robust", debiased=True)
    else:
        res = mod.fit(cov_type="clustered", clusters=clusters, debiased=small)
    n = int(res.nobs)
    k = len(res.params)
    names = list(res.params.index)
    params = res.params.to_numpy().copy()
    cov = res.cov.to_numpy().copy()
    if shift:
        ic = names.index("Constant")
        g = np.zeros(len(names))
        g[ic] = 1.0
        for col, cval in shift.items():
            g[names.index(col)] = -cval
        params[ic] = float(g @ res.params.to_numpy())
        v0 = float(g @ cov @ g)
        cov[ic, :] = g @ cov
        cov[:, ic] = cov[ic, :]
        cov[ic, ic] = v0
    sev = np.sqrt(np.diag(cov))
    stat = params / sev
    if small:
        p = 2 * stats.t.sf(np.abs(stat), n - k)
        crit = stats.t.ppf(0.975, n - k)
    else:
        p = 2 * stats.norm.sf(np.abs(stat))
        crit = stats.norm.ppf(0.975)
    # linearmodels' own p-values where its pairing matches (sanity of the crossed-cell construction).
    if res.debiased == small and not shift:
        assert np.allclose(p, res.pvalues.to_numpy(), rtol=1e-10, atol=1e-300)
    # Report order: endogenous, exogenous, constant.
    order = list(endog) + list(exog) + (["Constant"] if const else [])
    idx = [names.index(nm) for nm in order]
    nonc = [i for i, nm in enumerate(names) if nm != "Constant"]
    b = params[nonc]
    W = float(b @ np.linalg.solve(cov[np.ix_(nonc, nonc)], b))
    if small:
        wald = {"stat": W / len(nonc), "df1": len(nonc), "df2": n - k, "p": float(stats.f.sf(W / len(nonc), len(nonc), n - k)), "dist": "F"}
    else:
        wald = {"stat": W, "df1": len(nonc), "p": float(stats.chi2.sf(W, len(nonc))), "dist": "chi2"}
    if res.debiased == small and se != "hc0" or (se == "hc0" and not small):
        assert abs(res.f_statistic.stat - wald["stat"]) <= 1e-8 * abs(wald["stat"])
    rss = float(res.resid_ss)
    out = {
        "se": se,
        "small": small,
        "n": n,
        "terms": order,
        "params": [float(params[i]) for i in idx],
        "bse": [float(sev[i]) for i in idx],
        "stat": [float(stat[i]) for i in idx],
        "pvalues": [float(p[i]) for i in idx],
        "ci_lo": [float(params[i] - crit * sev[i]) for i in idx],
        "ci_hi": [float(params[i] + crit * sev[i]) for i in idx],
        "rsquared": float(res.rsquared),
        "rsquared_adj": float(res.rsquared_adj),
        "s2": rss / (n - k if small else n),
        "wald": wald,
    }
    # First stage under the same covariance (coefficients on the excluded instruments).
    fs = res.first_stage
    diag = fs.diagnostics
    # The textbook F: unadjusted with debiased=True.
    if se == "classical":
        res_tb = mod.fit(cov_type="unadjusted", debiased=True)
    else:
        res_tb = mod.fit(cov_type="unadjusted", debiased=True)
    diag_tb = res_tb.first_stage.diagnostics
    first = []
    for en in endog:
        ind = fs.individual[en]
        pn = list(ind.params.index)
        kz = len(pn)
        ip = [pn.index(z) for z in instr]
        pp = ind.params.to_numpy()
        cz = ind.cov.to_numpy()
        sz = np.sqrt(np.diag(cz))
        st = pp / sz
        if small:
            pz = 2 * stats.t.sf(np.abs(st), n - kz)
            cr = stats.t.ppf(0.975, n - kz)
        else:
            pz = 2 * stats.norm.sf(np.abs(st))
            cr = stats.norm.ppf(0.975)
        entry = {
            "endog": en,
            "params": [float(pp[i]) for i in ip],
            "bse": [float(sz[i]) for i in ip],
            "stat": [float(st[i]) for i in ip],
            "pvalues": [float(pz[i]) for i in ip],
            "ci_lo": [float(pp[i] - cr * sz[i]) for i in ip],
            "ci_hi": [float(pp[i] + cr * sz[i]) for i in ip],
            "rsquared": float(diag.loc[en, "rsquared"]),
            "partial_rsquared": float(diag.loc[en, "partial.rsquared"]),
            "f_classical": float(diag_tb.loc[en, "f.stat"]),
            "f_classical_p": float(diag_tb.loc[en, "f.pval"]),
            "df_z": n - kz,
        }
        if se == "classical" and not small:
            # linearmodels' own unadjusted f.stat (debiased=False) is n/(n-k) times the textbook F.
            entry["lm_f_unadjusted_nodebias"] = float(diag.loc[en, "f.stat"])
        if se != "classical":
            entry["wald_robust"] = float(diag.loc[en, "f.stat"])
            entry["wald_robust_p"] = float(diag.loc[en, "f.pval"])
        first.append(entry)
    out["first_stage"] = first
    # Diagnostics (covariance-independent ones and the Wooldridge score tests).
    dg = {}
    du = res.durbin()
    dg["durbin"] = [float(du.stat), int(du.df), float(du.pval)]
    wh = res.wu_hausman()
    dg["wu_hausman"] = [float(wh.stat), int(wh.df), int(wh.df_denom), float(wh.pval)]
    ws = res.wooldridge_score
    dg["wooldridge_score"] = [float(ws.stat), int(ws.df), float(ws.pval)]
    if len(instr) > len(endog):
        for key, t in [("sargan", res.sargan), ("basmann", res.basmann), ("wooldridge_overid", res.wooldridge_overid)]:
            dg[key] = [float(t.stat), int(t.df), float(t.pval)]
    out["diag"] = dg
    # The TRAP: OLS of y on the first-stage fitted X-hat (right beta, wrong sigma2 and SEs), classical sigma2 = e'e/n.
    if se == "classical":
        Z = np.column_stack([d[exog].astype(float).to_numpy()] + ([np.ones(n)] if const else []) + [d[instr].astype(float).to_numpy()]) if (exog or const) else d[instr].astype(float).to_numpy()
        X = np.column_stack([d[endog].astype(float).to_numpy()] + ([d[exog].astype(float).to_numpy()] if exog else []) + ([np.ones(n)] if const else []))
        Xh = Z @ np.linalg.lstsq(Z, X, rcond=None)[0]
        yv = d[dep].astype(float).to_numpy()
        bh = np.linalg.lstsq(Xh, yv, rcond=None)[0]
        eh = yv - Xh @ bh
        s2h = float(eh @ eh / (n - k if small else n))
        seh = np.sqrt(np.diag(s2h * np.linalg.inv(Xh.T @ Xh)))
        out["naive"] = {"s2": s2h, "bse": [float(v) for v in seh], "params": [float(v) for v in bh]}
    return out


COMBOS = [(se, sm) for se in ["classical", "hc0", "hc1", "cluster"] for sm in [False, True]]


def case_overid():
    rng = np.random.default_rng(20261025)
    n = 200
    x1 = rng.normal(0, 1, n)
    x2 = rng.uniform(0, 10, n)
    z1 = rng.normal(0, 1, n)
    z2 = rng.normal(0, 1, n) + 0.3 * x1
    v = rng.normal(0, 1, n)
    u = 0.6 * v + rng.normal(0, 1, n) * (0.5 + 0.1 * x2)
    d = 0.5 * z1 + 0.3 * z2 + 0.4 * x1 + v
    y = 1 + 2 * d + 0.5 * x1 - 0.3 * x2 + u
    g = rng.integers(0, 25, n)
    df = pd.DataFrame({"y": y, "d": d, "x1": x1, "x2": x2, "z1": z1, "z2": z2})
    df["firm"] = [f"f{int(k):02d}" for k in g]
    return df, {}


def case_exact2():
    rng = np.random.default_rng(777)
    n = 150
    z1 = rng.normal(0, 1, n)
    z2 = rng.normal(0, 1, n)
    v1 = rng.normal(0, 1, n)
    v2 = rng.normal(0, 1, n)
    u = 0.5 * v1 - 0.4 * v2 + rng.normal(0, 1, n)
    d1 = 0.8 * z1 + 0.2 * z2 + v1
    d2 = -0.3 * z1 + 0.7 * z2 + v2
    y = 0.5 + 1.5 * d1 - 1.0 * d2 + u
    # 30 clusters of unequal size (cluster ids are numbers).
    sizes = rng.integers(1, 10, 30)
    ids = np.repeat(np.arange(1, 31), sizes)
    ids = np.resize(ids, n)
    df = pd.DataFrame({"y": y, "d1": d1, "d2": d2, "z1": z1, "z2": z2})
    df["state"] = [str(int(k)) for k in ids]
    return df, {}


def case_awkward():
    rng = np.random.default_rng(4242)
    n = 100
    lvl = 1e6 + rng.normal(0, 1, n)  # an exogenous regressor at a level of 10^6 with unit variation
    z1 = rng.normal(0, 1, n) * 1e-6  # a tiny-scale instrument
    z2 = rng.exponential(1.0, n)
    z3 = rng.integers(0, 2, n).astype(float)
    v = rng.normal(0, 1, n)
    d = 3e5 * z1 + 0.4 * z2 + 0.5 * z3 + v
    u = 0.7 * v + rng.standard_t(4, n)
    y = 2.0 + 0.8 * d + 0.01 * (lvl - 1e6) + u
    # 12 clusters with very unequal sizes (one singleton).
    sizes = [1, 2, 3, 4, 5, 6, 8, 9, 11, 13, 17, 21]
    ids = np.repeat(np.arange(12), sizes)
    df = pd.DataFrame({"y": y, "d": d, "lvl": lvl, "z1": z1, "z2": z2, "z3": z3})
    df["grp"] = [f"g{int(k)}" for k in ids]
    na = {(5, "y"), (17, "z2"), (60, "d")}
    return df, na


def main():
    cases = []
    specs = [
        ("overid", case_overid, "y", ["x1", "x2"], ["d"], ["z1", "z2"], "firm", [True]),
        ("exact2", case_exact2, "y", [], ["d1", "d2"], ["z1", "z2"], "state", [True]),
        ("awkward", case_awkward, "y", ["lvl"], ["d"], ["z1", "z2", "z3"], "grp", [True, False]),
    ]
    # The awkward case's level-10^6 regressor beside the constant: linearmodels on the raw data is off in the 6th
    # digit (pinv/inv of cross-products at condition ~10^12); the shifted fit is exact to ~1e-12. Shown here.
    dfa, naa = case_awkward()
    ta = read_table(table_text(dfa, naa).replace("NA", "nan"))
    ta = ta[~ta[["y", "lvl", "d", "z1", "z2", "z3"]].isna().any(axis=1)].reset_index(drop=True)
    raw = run(ta, "y", ["lvl"], ["d"], ["z1", "z2", "z3"], True, "classical", False)
    sh = run(ta, "y", ["lvl"], ["d"], ["z1", "z2", "z3"], True, "classical", False, shift={"lvl": 1e6})
    print("awkward raw vs shifted, coef of d:", raw["params"][0], sh["params"][0])
    for name, fn, dep, exog, endog, instr, cl, consts in specs:
        df, na = fn()
        text = table_text(df, na)
        dfr = read_table(text.replace("NA", "nan"))
        drop = dfr[[dep] + exog + endog + instr].isna().any(axis=1)
        used = dfr[~drop].reset_index(drop=True)
        for const in consts:
            shift = {"lvl": 1e6} if name == "awkward" and const else None
            runs = [run(used, dep, exog, endog, instr, const, se, sm, cl if se == "cluster" else None, shift) for se, sm in COMBOS]
            cases.append({"name": name + ("" if const else "_noconst"), "table": text, "dep": dep, "exog": exog, "endog": endog,
                          "instr": instr, "cluster": cl, "constant": const, "dropped": int(drop.sum()), "runs": runs})
    # The calculator's default table.
    text = lcg_default()
    dfd = read_table(text)
    runs = [run(dfd, "lwage", ["exper"], ["educ"], ["dist", "sibs"], True, se, sm, None) for se, sm in COMBOS if se != "cluster"]
    cases.append({"name": "default", "table": text, "dep": "lwage", "exog": ["exper"], "endog": ["educ"], "instr": ["dist", "sibs"],
                  "cluster": None, "constant": True, "dropped": 0, "runs": runs})
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"generator": "scripts/econ-iv-oracle.py", "linearmodels": "7.1", "cases": cases}, f, indent=1)
    print("wrote", OUT, sum(len(c["runs"]) for c in cases), "runs")


if __name__ == "__main__":
    main()
