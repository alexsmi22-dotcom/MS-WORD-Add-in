"""
Oracle for the Release E4 adversarial-review fixes (iv-2sls, boot-ci, qreg). Synthetic data only (numpy default_rng
with fixed seeds); writes src/lib/__tests__/fixtures/econ-e4fix-oracle.json.

  qreg      statsmodels QuantReg's covariance formula evaluated in 60-digit mpmath at a FIXED residual vector (the
            vertex recovered from the HiGHS optimum), on uncentred polynomial designs: [year, year², 1] with year in
            1990..2020 (n = 400) and [x, x², 1] with x on [1000, 1010] (n = 300). Robust and iid.
  iv-ncol   near-collinear instruments z2 = z1 + eps·noise (eps = 1e−4, 1e−6, 1e−8): the first stage of w1 on
            [1, x1, z1, z2] in 60-digit mpmath: the textbook partial F, classical SEs (s² = SSR/(n − k)), the HC0
            Wald of the two instrument coefficients and their HC0 SEs.
  iv-weak   heteroskedastic first stage where the non-robust F is below 10 and the robust Wald/q above it (one
            instrument, and two), from linearmodels 7.1 first_stage.diagnostics.
  iv-const  constant = no with an implicit constant (a dummy set; a column of ones): linearmodels' R², adjusted R²
            and first-stage R², which use has_constant (shared/linalg.py) to decide centring.
  boot      the calculator's PCG32 bootstrap replayed by scripts/econ-boot-qreg-oracle.py (boot_case) at 1.2345×10⁹
            and 3×10⁻⁶.

Run: jurislab-oracle-venv python scripts/econ-e4fix-oracle.py
"""
import importlib.util
import json
import os

import mpmath as mp
import numpy as np
import pandas as pd
from scipy import stats
from linearmodels.iv import IV2SLS

mp.mp.dps = 60
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "__tests__", "fixtures", "econ-e4fix-oracle.json")

_spec = importlib.util.spec_from_file_location("bq", os.path.join(ROOT, "scripts", "econ-boot-qreg-oracle.py"))
bq = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bq)
num_str = bq.num_str


def table(cols):
    names = list(cols)
    n = len(cols[names[0]])
    lines = ["\t".join(names)]
    for i in range(n):
        lines.append("\t".join(cols[k][i] if isinstance(cols[k][i], str) else num_str(cols[k][i]) for k in names))
    return "\n".join(lines)


def exact(cols):
    """Round-trip every number through its shortest decimal, so both sides read the same doubles."""
    return {k: (v if isinstance(v[0], str) else np.array([float(num_str(x)) for x in v])) for k, v in cols.items()}


# ------------------------------------------------------------------------------------------------------------ qreg
def mp_qr_cov(X, e, y, tau, vcov):
    n, p = X.shape
    iq = stats.scoreatpercentile(e, 75) - stats.scoreatpercentile(e, 25)
    h0 = bq.hall_sheather(n, tau)
    h = min(np.std(y), iq / 1.34) * (stats.norm.ppf(tau + h0) - stats.norm.ppf(tau - h0))
    u = e / h
    fh = float(np.sum(np.where(np.abs(u) <= 1, 0.75 * (1 - u ** 2), 0))) / (n * h)
    Xm = mp.matrix([[mp.mpf(float(v)) for v in row] for row in X])
    A = (Xm.T * Xm) ** -1
    if vcov == "robust":
        dpos = mp.mpf(tau / fh) ** 2
        dneg = mp.mpf((1 - tau) / fh) ** 2
        Mm = mp.zeros(p, p)
        for i in range(n):
            d = dpos if e[i] > 0 else dneg
            for a in range(p):
                xa = Xm[i, a] * d
                for b in range(p):
                    Mm[a, b] += xa * Xm[i, b]
        V = A * Mm * A
    else:
        V = A * (mp.mpf(1 / fh) ** 2 * tau * (1 - tau))
    return [float(mp.sqrt(V[i, i])) for i in range(p)], h, 1 / fh


def qreg_case(name, cols, names, tau, vcov):
    cols = exact(cols)
    y = cols["y"]
    n = len(y)
    X = np.column_stack([cols[k] for k in names] + [np.ones(n)])
    p = X.shape[1]
    b_lp, obj = bq.lp_solve(X, y, tau)
    r = y - X @ b_lp
    basis = np.argsort(np.abs(r), kind="stable")[:p]
    b = np.linalg.solve(X[basis], y[basis])
    e = y - X @ b
    e[basis] = 0.0
    se, h, spars = mp_qr_cov(X, e, y, tau, vcov)
    return {
        "name": name, "data": table({"y": y, **{k: cols[k] for k in names}}), "spec": "y ~ " + " + ".join(names),
        "tau": tau, "se": vcov, "n": n, "nTauWhole": abs(n * tau - round(n * tau)) < 1e-9,
        "beta": b.tolist(), "resid": [float(v) for v in e], "seMp": se, "bandwidth": h, "sparsity": spars,
    }


def qreg_cases():
    out = []
    r = np.random.default_rng(12)
    yr = r.integers(1990, 2021, 400).astype(float)
    yv = 0.02 * (yr - 2005) ** 2 + 0.3 * (yr - 2005) + (1 + 0.1 * np.abs(yr - 2005)) * r.normal(size=400)
    c = {"y": yv, "year": yr, "year2": yr ** 2}
    out.append(qreg_case("year + year², tau 0.5 robust", c, ["year", "year2"], 0.5, "robust"))
    out.append(qreg_case("year + year², tau 0.5 iid", c, ["year", "year2"], 0.5, "iid"))
    out.append(qreg_case("year + year², tau 0.373 robust (n tau not whole)", c, ["year", "year2"], 0.373, "robust"))
    r = np.random.default_rng(1010)
    xp = r.uniform(1000, 1010, 300)
    yp = 0.05 * (xp - 1005) ** 2 + r.normal(size=300)
    c = {"y": yp, "x": xp, "x2": np.array([float(num_str(v)) for v in xp]) ** 2}
    out.append(qreg_case("x + x² on [1000, 1010], tau 0.5 robust", c, ["x", "x2"], 0.5, "robust"))
    out.append(qreg_case("x + x² on [1000, 1010], tau 0.5 iid", c, ["x", "x2"], 0.5, "iid"))
    out.append(qreg_case("x + x² on [1000, 1010], tau 0.627 robust (n tau not whole)", c, ["x", "x2"], 0.627, "robust"))
    return out


# -------------------------------------------------------------------------------------------------------- iv-ncol
def base(n, seed, het=True):
    """iv_gen.base with one endogenous regressor and two instruments."""
    r = np.random.default_rng(seed)
    x1 = r.normal(size=n)
    Z = r.normal(size=(n, 2))
    u = r.normal(size=n)
    v = r.normal(size=n)
    coefs = r.uniform(0.5, 1.0, size=2)
    xe = Z @ coefs + 0.3 * x1 + 0.6 * u + v
    e = u * (1 + (np.abs(Z[:, 0]) if het else 0))
    y = 1.0 + 0.5 * xe + 0.7 * x1 + e
    return {"y": y, "x1": x1, "w1": xe, "z1": Z[:, 0], "z2": Z[:, 1]}


def mp_first_stage(cols):
    n = len(cols["y"])
    Z = [[mp.mpf(1), mp.mpf(float(cols["x1"][i])), mp.mpf(float(cols["z1"][i])), mp.mpf(float(cols["z2"][i]))] for i in range(n)]
    Zm = mp.matrix(Z)
    xv = mp.matrix([mp.mpf(float(v)) for v in cols["w1"]])
    A = (Zm.T * Zm) ** -1
    b = A * (Zm.T * xv)
    res = xv - Zm * b
    ssr = sum(v * v for v in res)
    k = 4
    s2 = ssr / (n - k)
    I = [2, 3]
    AII = mp.matrix([[A[a, c] for c in I] for a in I])
    bI = mp.matrix([b[a] for a in I])
    F = (bI.T * (AII ** -1) * bI)[0] / s2 / 2
    meat = mp.zeros(4, 4)
    for i in range(n):
        r2 = res[i] ** 2
        for a in range(4):
            for c in range(4):
                meat[a, c] += Z[i][a] * Z[i][c] * r2
    V = A * meat * A
    VII = mp.matrix([[V[a, c] for c in I] for a in I])
    W = (bI.T * (VII ** -1) * bI)[0]
    # 2SLS: X = [w1, x1, 1] (the calculator's order: instrumented, exogenous, constant), X̂ = P_Z X.
    X = mp.matrix([[mp.mpf(float(cols["w1"][i])), mp.mpf(float(cols["x1"][i])), mp.mpf(1)] for i in range(n)])
    yv = mp.matrix([mp.mpf(float(v)) for v in cols["y"]])
    Xh = Zm * (A * (Zm.T * X))
    beta = ((Xh.T * Xh) ** -1) * (Xh.T * yv)
    return {
        "beta2sls": [float(beta[i]) for i in range(3)],
        "F": float(F), "seClassical": [float(mp.sqrt(A[a, a] * s2)) for a in I], "waldHc0": float(W),
        "seHc0": [float(mp.sqrt(V[a, a])) for a in I], "coef": [float(b[a]) for a in I],
    }


def iv_ncol_cases():
    out = []
    for k, eps in enumerate([1e-4, 1e-6, 1e-8]):
        c = base(200, 4)
        r = np.random.default_rng(40 + k)
        c["z2"] = c["z1"] + eps * r.normal(size=200)
        c = exact(c)
        out.append({"name": f"z2 = z1 + {eps:g}·noise", "eps": eps, "data": table(c), **mp_first_stage(c)})
    return out


# -------------------------------------------------------------------------------------------------------- iv-weak
def lm_first(df, exog, endog, instr, const):
    ex = df[exog].astype(float) if exog else pd.DataFrame(index=df.index)
    if const:
        ex = ex.copy()
        ex["Constant"] = 1.0
    ex = ex if ex.shape[1] else None
    mod = IV2SLS(df["y"], ex, df[endog], df[instr])
    tb = mod.fit(cov_type="unadjusted", debiased=True).first_stage.diagnostics
    rb = mod.fit(cov_type="robust", debiased=False).first_stage.diagnostics
    return {
        "fClassical": [float(tb.loc[e, "f.stat"]) for e in endog],
        "waldHc0": [float(rb.loc[e, "f.stat"]) for e in endog],
    }


def iv_weak_cases():
    out = []
    r = np.random.default_rng(13)
    n = 400
    z = r.normal(size=n)
    u = r.normal(size=n)
    sd = 3.0 / (1 + 4 * z ** 2)
    w = 0.13 * z + sd * r.normal(size=n) + 0.3 * u + 0.3 * r.normal(size=n)
    y = 1 + 0.5 * w + u
    c = exact({"y": y, "w1": w, "z1": z})
    o = lm_first(pd.DataFrame(c), [], ["w1"], ["z1"], True)
    assert o["fClassical"][0] < 10 <= o["waldHc0"][0], o
    out.append({"name": "one instrument", "data": table(c), "spec": "y ~", "instruments": "z1", **o})
    # Overidentified: the first seed (from 100) whose non-robust F is below 10 and robust Wald/2 at least 10.
    for seed in range(100, 400):
        r = np.random.default_rng(seed)
        z1 = r.normal(size=n)
        z2 = r.normal(size=n)
        u = r.normal(size=n)
        sd = 3.0 / (1 + 2 * z1 ** 2 + 2 * z2 ** 2)
        w = 0.1 * z1 + 0.1 * z2 + sd * r.normal(size=n) + 0.3 * u + 0.3 * r.normal(size=n)
        y = 1 + 0.5 * w + u
        c = exact({"y": y, "w1": w, "z1": z1, "z2": z2})
        o = lm_first(pd.DataFrame(c), [], ["w1"], ["z1", "z2"], True)
        if o["fClassical"][0] < 10 and o["waldHc0"][0] / 2 >= 10:
            out.append({"name": f"two instruments (seed {seed})", "data": table(c), "spec": "y ~", "instruments": "z1 + z2", **o})
            break
    assert len(out) == 2
    return out


# ------------------------------------------------------------------------------------------------------- iv-const
def lm_r2(df, exog, endog, instr, se, small):
    mod = IV2SLS(df["y"], df[exog].astype(float), df[endog], df[instr])
    if se == "classical":
        res = mod.fit(cov_type="unadjusted", debiased=small)
    elif se == "hc0":
        res = mod.fit(cov_type="robust", debiased=False)
    else:
        res = mod.fit(cov_type="robust", debiased=True)
    assert mod.has_constant
    d = res.first_stage.diagnostics
    return {"r2": float(res.rsquared), "adjR2": float(res.rsquared_adj), "fsR2": [float(d.loc[e, "rsquared"]) for e in endog]}


def iv_const_cases():
    out = []
    c = base(200, 5)
    r = np.random.default_rng(55)
    d = (r.uniform(size=200) < 0.4).astype(float)
    c["d1"] = d
    c["d0"] = 1 - d
    c["y"] = c["y"] + 3
    c = exact(c)
    o = lm_r2(pd.DataFrame(c), ["x1", "d1", "d0"], ["w1"], ["z1", "z2"], "classical", False)
    out.append({"name": "dummy set d1 + d0 = 1", "data": table(c), "spec": "y ~ x1 + d1 + d0", "se": "classical", "small": "z", **o})
    c = base(200, 6)
    c["one"] = np.ones(200)
    c = exact(c)
    o = lm_r2(pd.DataFrame(c), ["x1", "one"], ["w1"], ["z1", "z2"], "hc1", True)
    out.append({"name": "a column of ones", "data": table(c), "spec": "y ~ x1 + one", "se": "hc1", "small": "t", **o})
    return out


# ----------------------------------------------------------------------------------------------------------- boot
def boot_cases():
    r = np.random.default_rng(99)
    big = 1.2345e9 + 1e5 * r.normal(size=40)
    tiny = 1e-7 * r.normal(size=40) + 3e-6
    return [
        bq.boot_case("mean at 1.2345e9, SE ~1.6e4", "mean", big, None, 2000, 0.95, 12345),
        bq.boot_case("mean at 3e-6, SE ~1.6e-8", "mean", tiny, None, 2000, 0.95, 12345),
    ]


def main():
    fx = {"qreg": qreg_cases(), "ivNcol": iv_ncol_cases(), "ivWeak": iv_weak_cases(), "ivConst": iv_const_cases(), "boot": boot_cases()}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fx, f, indent=1)
    print("wrote", OUT, {k: len(v) for k, v in fx.items()})


if __name__ == "__main__":
    main()
