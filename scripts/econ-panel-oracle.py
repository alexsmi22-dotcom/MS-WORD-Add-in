"""Oracle for src/lib/panel.ts and src/lib/did.ts (Release E4b): linearmodels 7.1 PanelOLS and RandomEffects on
SYNTHETIC panels (fixed seeds, generated here; no bundled example dataset is used), plus the Hausman test as a numpy
formula on linearmodels' classical covariances (linearmodels has no Hausman test).

Run with the oracle venv:
  C:\\Users\\AlexanderSmith\\jurislab-oracle-venv\\Scripts\\python.exe scripts/econ-panel-oracle.py

Writes src/lib/__tests__/fixtures/econ-panel-oracle.json. Every table is stored as tab-separated text, exactly what
the calculators read.

Conventions pinned (read from linearmodels/panel/model.py and covariance.py):
  PanelOLS(..., entity_effects=True, time_effects=...) with a constant column, singletons=True (default);
  fit(cov_type=..., debiased=True (default), group_debias=True for clustered), auto_df=True (default).
  RandomEffects().fit(small_sample=False (default), cov_type=..., debiased=True, group_debias=True for clustered).
"""
import json
import os
import warnings

import numpy as np
import pandas as pd
from linearmodels import PanelOLS, RandomEffects

warnings.simplefilter("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "..", "src", "lib", "__tests__", "fixtures")


def tsv(df):
    lines = ["\t".join(df.columns)]
    for row in df.itertuples(index=False):
        cells = []
        for v in row:
            if isinstance(v, (float, np.floating)):
                cells.append(repr(float(v)))
            else:
                cells.append(str(v))
        lines.append("\t".join(cells))
    return "\n".join(lines)


def panel_index(df, ent, tkey):
    """MultiIndex (entity code, time code): time codes in sorted order of tkey, entity codes by first appearance."""
    tcodes = {k: i for i, k in enumerate(sorted(df[tkey].unique()))}
    ecodes = {}
    for e in df[ent]:
        if e not in ecodes:
            ecodes[e] = len(ecodes)
    idx = pd.MultiIndex.from_arrays([df[ent].map(ecodes).values, df[tkey].map(tcodes).values], names=["e", "t"])
    return idx


def fit_args(se, df, cluster_col):
    if se == "classical":
        return dict(cov_type="unadjusted")
    if se == "robust":
        return dict(cov_type="robust")
    if se == "cluster-entity":
        return dict(cov_type="clustered", cluster_entity=True, group_debias=True)
    codes = pd.Categorical(df[cluster_col]).codes
    return dict(cov_type="clustered", clusters=pd.Series(codes, index=None), group_debias=True)


def stat(ts):
    try:
        return {"stat": float(ts.stat), "p": float(ts.pval), "df": int(ts.df), "df_denom": int(getattr(ts, "df_denom", 0) or 0)}
    except Exception:
        return None


def run_fe(name, df, y, xs, ent, tkey, effects, se, cluster_col=None):
    idx = panel_index(df, ent, tkey)
    Y = pd.Series(df[y].values.astype(float), index=idx, name=y)
    X = pd.DataFrame({x: df[x].values.astype(float) for x in xs}, index=idx)
    X["Constant"] = 1.0
    mod = PanelOLS(Y, X, entity_effects=True, time_effects=(effects == "twoway"))
    kw = fit_args(se, df, cluster_col)
    if "clusters" in kw:
        kw["clusters"] = pd.DataFrame({"c": pd.Categorical(df[cluster_col]).codes}, index=idx)
    r = mod.fit(**kw)
    return {
        "name": name,
        "method": "fe",
        "effects": effects,
        "se": se,
        "y": y,
        "x": xs,
        "entity": ent,
        "time": tkey,
        "cluster": cluster_col,
        "params": {k: float(v) for k, v in r.params.items()},
        "se_": {k: float(v) for k, v in r.std_errors.items()},
        "p": {k: float(v) for k, v in r.pvalues.items()},
        "df_resid": int(r.df_resid),
        "r2": float(r.rsquared),
        "r2w": float(r.rsquared_within),
        "r2b": float(r.rsquared_between),
        "r2o": float(r.rsquared_overall),
        "f": stat(r.f_statistic_robust),
        "f_pooled": stat(r.f_pooled),
        "nobs": int(r.nobs),
        "cov_classical": None,
    }


def run_re(name, df, y, xs, ent, tkey, se, cluster_col=None):
    idx = panel_index(df, ent, tkey)
    Y = pd.Series(df[y].values.astype(float), index=idx, name=y)
    X = pd.DataFrame({x: df[x].values.astype(float) for x in xs}, index=idx)
    X["Constant"] = 1.0
    mod = RandomEffects(Y, X)
    kw = fit_args(se, df, cluster_col)
    if "clusters" in kw:
        kw["clusters"] = pd.DataFrame({"c": pd.Categorical(df[cluster_col]).codes}, index=idx)
    r = mod.fit(**kw)
    theta = np.asarray(r.theta).ravel()
    return {
        "name": name,
        "method": "re",
        "se": se,
        "y": y,
        "x": xs,
        "entity": ent,
        "time": tkey,
        "cluster": cluster_col,
        "params": {k: float(v) for k, v in r.params.items()},
        "se_": {k: float(v) for k, v in r.std_errors.items()},
        "p": {k: float(v) for k, v in r.pvalues.items()},
        "df_resid": int(r.df_resid),
        "r2": float(r.rsquared),
        "r2w": float(r.rsquared_within),
        "r2b": float(r.rsquared_between),
        "r2o": float(r.rsquared_overall),
        "f": stat(r.f_statistic_robust),
        "sigma2_eps": float(r.variance_decomposition["Residual"]),
        "sigma2_u": float(r.variance_decomposition["Effects"]),
        "theta_min": float(theta.min()),
        "theta_max": float(theta.max()),
        "nobs": int(r.nobs),
    }


HAUSMAN_RANK_TOL = 1e-10  # the same constant as panel.ts HAUSMAN_RANK_TOL


def hausman(df, y, xs_tv, xs_all, ent, tkey):
    """(b_FE − b_RE)' (V_FE − V_RE)^-1 (b_FE − b_RE) on the time-varying regressors, from linearmodels' classical
    covariances. Three forms, as panel.ts:
      classic   — V_FE − V_RE positive definite (smallest eigenvalue above 1e-10 × the largest diagonal of V_FE);
      sigmamore — else Stata's hausman, sigmamore: both covariances on the efficient (RE) estimator's disturbance
                  variance, e(rmse)² after xtreg, re (Stata's manual), i.e. the RE regression's s² = SSR/(n − k):
                  V_FE × s²_RE/s²_FE − V_RE, used when positive definite;
      pinv      — else the Moore–Penrose inverse over the eigenvalues above 1e-10 × the largest diagonal of the
                  rescaled V_FE, df = their number (Stata: df = rank of the difference); skipped if an eigenvalue is
                  below minus that tolerance."""
    from scipy import stats

    idx = panel_index(df, ent, tkey)
    Y = pd.Series(df[y].values.astype(float), index=idx, name=y)
    Xf = pd.DataFrame({x: df[x].values.astype(float) for x in xs_tv}, index=idx)
    Xf["Constant"] = 1.0
    Xr = pd.DataFrame({x: df[x].values.astype(float) for x in xs_all}, index=idx)
    Xr["Constant"] = 1.0
    fe = PanelOLS(Y, Xf, entity_effects=True).fit(cov_type="unadjusted")
    re = RandomEffects(Y, Xr).fit(cov_type="unadjusted")
    d = np.array([fe.params[x] - re.params[x] for x in xs_tv])
    Vf = fe.cov.loc[xs_tv, xs_tv].values
    Vr = re.cov.loc[xs_tv, xs_tv].values
    scale = np.abs(np.diag(Vf)).max()
    q = len(xs_tv)
    V = Vf - Vr
    ev = np.linalg.eigvalsh(V)
    if ev.min() > 1e-10 * scale:
        h = float(d @ np.linalg.solve(V, d))
        return {"form": "classic", "stat": h, "df": q, "p": float(stats.chi2.sf(h, q))}
    s2fe = float(fe.resid_ss) / int(fe.df_resid)
    s2re = float(re.resid_ss) / int(re.df_resid)
    # The covariances really are s² (X'X)⁻¹ with these s² (checked against the classic covariances' own scale).
    r = s2re / s2fe
    S = r * Vf - Vr
    lam, vec = np.linalg.eigh(S)
    out = {"classic_stat": float(d @ np.linalg.solve(V, d)), "classic_min_eig": float(ev.min()), "s2_fe": s2fe, "s2_re": s2re, "sm_eig": lam.tolist()}
    if lam.min() > 1e-10 * r * scale:
        h = float(d @ np.linalg.solve(S, d))
        out.update({"form": "sigmamore", "stat": h, "df": q, "p": float(stats.chi2.sf(h, q))})
        return out
    tol = HAUSMAN_RANK_TOL * r * scale
    if lam.min() < -tol:
        out.update({"form": "skipped"})
        return out
    keep = lam > tol
    proj = vec[:, keep].T @ d
    h = float(np.sum(proj**2 / lam[keep]))
    k = int(keep.sum())
    out.update({"form": "pinv", "stat": h, "df": k, "p": float(stats.chi2.sf(h, k))})
    return out


cases = []

# --- FE / RE 1: balanced, 25 firms × 6 years -------------------------------------------------------------------
rng = np.random.default_rng(20261025)
N, T = 25, 6
rows = []
alpha = rng.normal(0, 2, N)
for i in range(N):
    for t in range(T):
        x1 = 0.5 * alpha[i] + rng.normal()
        x2 = rng.normal()
        yv = 3 + alpha[i] + 1.5 * x1 - 0.8 * x2 + rng.normal(0, 1 + 0.3 * abs(x2))
        rows.append({"firm": f"F{i + 1:02d}", "year": 2015 + t, "y": round(yv, 6), "x1": round(x1, 6), "x2": round(x2, 6)})
bal = pd.DataFrame(rows)
for se in ["classical", "robust", "cluster-entity"]:
    cases.append(run_fe(f"fe_bal_{se}", bal, "y", ["x1", "x2"], "firm", "year", "entity", se))
cases.append(run_fe("fe_bal_twoway_classical", bal, "y", ["x1", "x2"], "firm", "year", "twoway", "classical"))
for se in ["classical", "robust", "cluster-entity"]:
    cases.append(run_re(f"re_bal_{se}", bal, "y", ["x1", "x2"], "firm", "year", se))
haus_bal = hausman(bal, "y", ["x1", "x2"], ["x1", "x2"], "firm", "year")

# --- FE 2: unbalanced two-way, quarters as time labels, two singleton entities --------------------------------
rng = np.random.default_rng(7)
N, T = 30, 8
quarters = [f"{2019 + q // 4} Q{q % 4 + 1}" for q in range(T)]
alpha = rng.normal(0, 1.5, N)
delta = rng.normal(0, 1, T)
rows = []
for i in range(N):
    for t in range(T):
        if i < 28 and rng.random() < 0.3:
            continue
        if i >= 28 and t != i - 26:  # entities 29, 30: one row each (singletons)
            continue
        x1 = 0.4 * alpha[i] + 0.5 * delta[t] + rng.normal()
        x2 = rng.normal()
        yv = alpha[i] + delta[t] + 0.7 * x1 + 1.2 * x2 + rng.normal(0, 0.8)
        rows.append({"unit": f"u{i + 1}", "quarter": quarters[t], "qkey": t, "y": round(yv, 6), "x1": round(x1, 6), "x2": round(x2, 6)})
unb = pd.DataFrame(rows)
for se in ["classical", "robust", "cluster-entity"]:
    c = run_fe(f"fe_unbal_twoway_{se}", unb, "y", ["x1", "x2"], "unit", "qkey", "twoway", se)
    c["time"] = "quarter"
    cases.append(c)

# --- FE 3: entities nested in industries; a region that varies within entity -------------------------------------
rng = np.random.default_rng(99)
N, T = 40, 5
ind = [f"ind{i % 8 + 1}" for i in range(N)]
alpha = rng.normal(0, 1, N)
rows = []
for i in range(N):
    for t in range(T):
        if rng.random() < 0.15:
            continue
        x1 = alpha[i] + rng.normal()
        yv = 2 * alpha[i] - 0.5 * x1 + rng.normal()
        rows.append({"id": f"e{i + 1}", "t": t + 1, "industry": ind[i], "region": f"r{rng.integers(1, 7)}", "y": round(yv, 6), "x1": round(x1, 6)})
nest = pd.DataFrame(rows)
cases.append(run_fe("fe_cluster_nested", nest, "y", ["x1"], "id", "t", "entity", "cluster-column", "industry"))
cases.append(run_fe("fe_cluster_notnested", nest, "y", ["x1"], "id", "t", "entity", "cluster-column", "region"))

# --- FE 4: T > N (dummies of the entities), large levels and tiny response ----------------------------------------
rng = np.random.default_rng(31415)
N, T = 5, 40
rows = []
alpha = rng.normal(0, 1, N)
delta = rng.normal(0, 1, T)
for i in range(N):
    for t in range(T):
        if rng.random() < 0.1:
            continue
        x1 = 1e4 + 10 * (alpha[i] + delta[t] + rng.normal())
        yv = 1e-6 * (alpha[i] - delta[t] + 0.03 * (x1 - 1e4) + rng.normal())
        rows.append({"country": f"C{i + 1}", "year": 1980 + t, "y": float(f"{yv:.9e}"), "x1": round(x1, 4)})
big = pd.DataFrame(rows)
cases.append(run_fe("fe_scale_twoway_classical", big, "y", ["x1"], "country", "year", "twoway", "classical"))
cases.append(run_fe("fe_scale_twoway_robust", big, "y", ["x1"], "country", "year", "twoway", "robust"))

# --- RE 2: unbalanced with a time-invariant regressor ---------------------------------------------------------------
rng = np.random.default_rng(2024)
N, T = 45, 7
alpha = rng.normal(0, 1.2, N)
z = rng.normal(0, 1, N).round(4)
rows = []
for i in range(N):
    Ti = int(rng.integers(2, T + 1))
    for t in range(Ti):
        x1 = rng.normal() + 0.3 * alpha[i]
        yv = 1 + alpha[i] + 0.9 * x1 + 0.5 * z[i] + rng.normal()
        rows.append({"person": f"p{i + 1}", "wave": t + 1, "y": round(yv, 6), "x1": round(x1, 6), "z": float(z[i])})
reu = pd.DataFrame(rows)
for se in ["classical", "robust", "cluster-entity"]:
    cases.append(run_re(f"re_unbal_tinv_{se}", reu, "y", ["x1", "z"], "person", "wave", se))
haus_reu = hausman(reu, "y", ["x1"], ["x1", "z"], "person", "wave")

# --- RE 3: no entity effect, σ²ᵤ truncated at 0 (the first seed from 500 that truncates) ---------------------------
for seed in range(500, 600):
    rng = np.random.default_rng(seed)
    N, T = 20, 4
    rows = []
    for i in range(N):
        for t in range(T):
            x1 = rng.normal()
            yv = 0.5 + 1.0 * x1 + rng.normal()
            rows.append({"g": f"g{i + 1}", "t": t + 1, "y": round(yv, 6), "x1": round(x1, 6)})
    rez = pd.DataFrame(rows)
    probe = run_re("probe", rez, "y", ["x1"], "g", "t", "classical")
    if probe["sigma2_u"] == 0.0:
        break
rez_seed = seed
cases.append(run_re("re_zero_classical", rez, "y", ["x1"], "g", "t", "classical"))
cases.append(run_re("re_zero_cluster-entity", rez, "y", ["x1"], "g", "t", "cluster-entity"))
haus_rez = hausman(rez, "y", ["x1"], ["x1"], "g", "t")

# --- RE 4: a regressor at level 10⁶ with within SD 1 (counted in the within rank, as lstsq does) and a second
#     regressor; effects uncorrelated with the regressors, so the two-regressor Hausman is positive definite ----------
rng = np.random.default_rng(4242)
N, T = 50, 6
rows = []
for i in range(N):
    a = rng.normal(0, 0.8)
    b = rng.normal(0, 1)
    cc = rng.normal(0, 1)
    for t in range(T):
        if rng.random() < 0.1:
            continue
        x1 = 1e6 + 3 * b + rng.normal()
        x2 = 2 * cc + rng.normal()
        yv = 2 + a + 0.5 * (x1 - 1e6) - 0.7 * x2 + rng.normal()
        rows.append({"id": f"i{i + 1}", "t": t + 1, "y": round(yv, 6), "x1": round(x1, 6), "x2": round(x2, 6)})
rel = pd.DataFrame(rows)
def mp_re_se(df, c, ent, y, xs):
    """RE standard errors at 50 digits, at linearmodels' own σ²ε and σ²ᵤ: linearmodels inverts the UNCENTRED
    quasi-demeaned XᵀX, which loses about 4 digits when a regressor sits at 10⁶ (measured: 5.7×10⁻⁵ relative)."""
    import mpmath as mp

    mp.mp.dps = 50
    g = df.groupby(ent)
    T = g[y].transform("count").values
    s2e, s2u = c["sigma2_eps"], c["sigma2_u"]
    theta = 1 - np.sqrt(s2e / (T * s2u + s2e))
    n, k = len(df), len(xs) + 1

    def qd(col):
        v, m = df[col].values, g[col].transform("mean").values
        return [mp.mpf(float(a)) - mp.mpf(float(t)) * mp.mpf(float(b)) for a, b, t in zip(v, m, theta)]

    X = mp.matrix(n, k)
    for j, col in enumerate(xs):
        for i, v in enumerate(qd(col)):
            X[i, j] = v
    for i in range(n):
        X[i, k - 1] = 1 - mp.mpf(float(theta[i]))
    Y = mp.matrix(qd(y))
    A = (X.T * X) ** -1
    e = Y - X * (A * (X.T * Y))
    if c["se"] == "classical":
        V = A * (sum(v**2 for v in e) / (n - k))
    else:
        M = mp.matrix(k, k)
        if c["se"] == "robust":
            for i in range(n):
                for a in range(k):
                    for b in range(k):
                        M[a, b] += e[i] ** 2 * X[i, a] * X[i, b]
            scale = mp.mpf(n) / (n - k)
        else:
            codes = pd.Categorical(df[ent]).codes
            G = len(set(codes))
            U = [mp.matrix(k, 1) for _ in range(G)]
            for i in range(n):
                for a in range(k):
                    U[codes[i]][a] += e[i] * X[i, a]
            for u in U:
                M += u * u.T
            scale = mp.mpf(G) / (G - 1) * (n - 1) / (n - k)
        V = A * M * A * scale
    names = xs + ["Constant"]
    return {names[j]: float(mp.sqrt(V[j, j])) for j in range(k)}


for se in ["classical", "robust", "cluster-entity"]:
    c = run_re(f"re_level_{se}", rel, "y", ["x1", "x2"], "id", "t", se)
    c["se_mp"] = mp_re_se(rel, c, "id", "y", ["x1", "x2"])
    cases.append(c)
# FE refuses x1 at this level by linearmodels' absorbed rule (less than 1e-5 of its norm survives demeaning), so the
# two-regressor Hausman case uses the same data with x1 shifted by −10⁶ (FE and RE slopes are unchanged by a shift).
rel_c = rel.copy()
rel_c["x1"] = (rel_c["x1"] - 1e6).round(6)
for se in ["classical"]:
    cases.append(run_re(f"re_hq2_{se}", rel_c, "y", ["x1", "x2"], "id", "t", se))
haus_q2 = hausman(rel_c, "y", ["x1", "x2"], ["x1", "x2"], "id", "t")

# --- DiD 1: 2 × 2, balanced ------------------------------------------------------------------------------------------
rng = np.random.default_rng(1111)
rows = []
for i in range(40):
    treated = i < 20
    a = rng.normal(0, 1)
    for t, yr in enumerate([2019, 2020]):
        d = 1 if (treated and t == 1) else 0
        yv = 5 + a + 0.8 * t + 0.5 * treated + 2.0 * d + rng.normal()
        rows.append({"school": f"s{i + 1}", "year": yr, "score": round(yv, 6), "treat": d})
d22 = pd.DataFrame(rows)
c = run_fe("did_2x2", d22, "score", ["treat"], "school", "year", "twoway", "cluster-entity")
c["method"] = "did"
grp = d22.groupby("school")["treat"].max()
d22["group"] = d22["school"].map(grp)
means = d22.groupby(["group", "year"])["score"].mean()
c["means"] = {"treated_pre": float(means[(1, 2019)]), "treated_post": float(means[(1, 2020)]), "control_pre": float(means[(0, 2019)]), "control_post": float(means[(0, 2020)])}
cases.append(c)

# --- DiD 2: common timing, 8 periods, unbalanced, a control, robust ---------------------------------------------------
rng = np.random.default_rng(2222)
rows = []
for i in range(50):
    treated = i < 20
    a = rng.normal(0, 1)
    for t in range(8):
        if rng.random() < 0.1:
            continue
        d = 1 if (treated and t >= 4) else 0
        x = rng.normal()
        yv = a + 0.3 * t + 1.5 * d + 0.6 * x + rng.normal()
        rows.append({"county": f"c{i + 1:02d}", "period": t + 1, "y": round(yv, 6), "D": d, "x": round(x, 6)})
dcom = pd.DataFrame(rows)
c = run_fe("did_common_robust", dcom, "y", ["D", "x"], "county", "period", "twoway", "robust")
c["method"] = "did"
cases.append(c)


def event_dummies(df, ent, tkey, dcol, leads, lags):
    """Relative period = rank of the period − rank of the entity's first treated period; ends binned; −1 omitted."""
    periods = sorted(df[tkey].unique())
    rank = {p: i for i, p in enumerate(periods)}
    first = {}
    for e, g in df.groupby(ent):
        tr = g[g[dcol] == 1]
        if len(tr):
            first[e] = rank[tr[tkey].min()]
    names = []
    cols = {}
    for r in range(-leads, lags + 1):
        if r == -1:
            continue
        cols[r] = []
    for _, row in df.iterrows():
        e = row[ent]
        rel = None
        if e in first:
            rel = min(max(rank[row[tkey]] - first[e], -leads), lags)
        for r in cols:
            cols[r].append(1.0 if rel == r else 0.0)
    out = df.copy()
    for r in cols:
        nm = f"rel_{r}"
        out[nm] = cols[r]
        if out[nm].sum() > 0:
            names.append(nm)
    return out, names


# --- DiD 3: staggered adoption, cohorts at periods 4, 6, 8, never-treated controls; event study ---------------------
rng = np.random.default_rng(3333)
rows = []
for i in range(60):
    start = [4, 6, 8, None][i % 4]
    a = rng.normal(0, 1)
    for t in range(1, 11):
        d = 1 if (start is not None and t >= start) else 0
        eff = (1.0 + 0.25 * (t - start)) if d else 0.0
        yv = a + 0.2 * t + eff + rng.normal(0, 0.7)
        rows.append({"state": f"st{i + 1:02d}", "year": 2010 + t, "y": round(yv, 6), "treated": d})
dst = pd.DataFrame(rows)
c = run_fe("did_stagger_cluster", dst, "y", ["treated"], "state", "year", "twoway", "cluster-entity")
c["method"] = "did"
cases.append(c)
ev, evn = event_dummies(dst, "state", "year", "treated", 3, 3)
c = run_fe("event_stagger_3_3", ev, "y", evn, "state", "year", "twoway", "cluster-entity")
c["method"] = "event"
c["leads"], c["lags"], c["treat"] = 3, 3, "treated"
cases.append(c)
ev3, evn3 = event_dummies(dcom, "county", "period", "D", 6, 2)  # bin ≤ −6 has no rows: dropped
c = run_fe("event_common_6_2_robust", ev3, "y", evn3, "county", "period", "twoway", "robust")
c["method"] = "event"
c["leads"], c["lags"], c["treat"] = 6, 2, "D"
cases.append(c)
ev2, evn2 = event_dummies(dcom, "county", "period", "D", 4, 4)
c = run_fe("event_common_4_4", ev2, "y", evn2 + ["x"], "county", "period", "twoway", "cluster-entity")
c["method"] = "event"
c["leads"], c["lags"], c["treat"] = 4, 4, "D"
cases.append(c)

# =====================================================================================================================
# E4 review cases (the adversarial review's generators, reproduced here: synthetic, fixed seeds).


def mk_panel(N, T, miss=0.2, singletons=3, seed=1, corr=1.0):
    g = np.random.default_rng(seed)
    rows = []
    for i in range(N):
        a = g.normal() * 2
        z = g.normal()
        for t in range(T):
            if i < singletons and t != (i % T):
                continue
            if i >= singletons and g.random() < miss:
                continue
            x1 = g.normal() + corr * a * 0.5
            x2 = g.normal() * 3 + 0.2 * t
            g.integers(0, 6)  # the review's state column: drawn to keep the stream, not used
            yv = 1 + a + 1.5 * x1 - 0.7 * x2 + 0.5 * z + 0.3 * t + g.normal() * (1 + 0.5 * abs(x1))
            rows.append(dict(firm=f"F{i:03d}", year=2000 + t, y=yv, x1=x1, x2=x2, z=z, trend=float(t)))
    return pd.DataFrame(rows)


def tsv_na(df):
    """As tsv, with NaN written as NA."""
    lines = ["\t".join(df.columns)]
    for row in df.itertuples(index=False):
        cells = []
        for v in row:
            if isinstance(v, (float, np.floating)) and np.isnan(v):
                cells.append("NA")
            elif isinstance(v, (float, np.floating)):
                cells.append(repr(float(v)))
            else:
                cells.append(str(v))
        lines.append("\t".join(cells))
    return "\n".join(lines)


adv_data = {}
adv_cases = []

# Hausman where a regressor is correlated with the entity effect: the classic difference is indefinite.
P = mk_panel(40, 8)
adv_data["adv_P"] = tsv(P[["firm", "year", "y", "x1", "x2", "z"]])
c = run_re("adv_re_classical", P, "y", ["x1", "x2", "z"], "firm", "year", "classical")
c["data"] = "adv_P"
adv_cases.append(c)
haus_adv_classical = hausman(P, "y", ["x1", "x2"], ["x1", "x2", "z"], "firm", "year")

# Regressors that vary only over time on a balanced panel: a trend, year dummies.
B = mk_panel(30, 6, miss=0.0, singletons=0, seed=11)
for t in range(1, 6):
    B[f"d{t}"] = (B["year"] == 2000 + t).astype(float)
adv_data["adv_B"] = tsv(B[["firm", "year", "y", "x1", "trend", "d1", "d2", "d3", "d4", "d5"]])
for nm, xs, se in [("adv_re_trend_classical", ["x1", "trend"], "classical"), ("adv_re_ydum_cluster-entity", ["x1", "d1", "d2", "d3", "d4", "d5"], "cluster-entity"),
                   ("adv_re_ydum_classical", ["x1", "d1", "d2", "d3", "d4", "d5"], "classical")]:
    c = run_re(nm, B, "y", xs, "firm", "year", se)
    c["data"] = "adv_B"
    adv_cases.append(c)
haus_adv_trend = hausman(B, "y", ["x1", "trend"], ["x1", "trend"], "firm", "year")
haus_adv_ydum = hausman(B, "y", ["x1", "d1", "d2", "d3", "d4", "d5"], ["x1", "d1", "d2", "d3", "d4", "d5"], "firm", "year")

# Unbalanced, with the trend still collinear in the entity means: each entity's periods are symmetric about period 3
# ({3}, {2,3,4}, {1..5} or {0..6}), so every entity's mean trend is 3.
g = np.random.default_rng(777)
rows = []
for i in range(36):
    a = g.normal() * 1.5
    w = [0, 1, 2, 3][i % 4]
    for t in range(3 - w, 4 + w):
        x1 = g.normal() + 0.4 * a
        yv = 2 + a + 1.5 * x1 + 0.3 * t + g.normal()
        rows.append(dict(firm=f"G{i:02d}", year=2000 + t, y=yv, x1=x1, trend=float(t)))
U = pd.DataFrame(rows)
adv_data["adv_U"] = tsv(U)
c = run_re("adv_re_unbsym_trend_classical", U, "y", ["x1", "trend"], "firm", "year", "classical")
c["data"] = "adv_U"
adv_cases.append(c)
# Unbalanced year dummies (rows dropped): the means vary, the between regression has full rank.
Bu = B.drop(index=B.sample(frac=0.15, random_state=5).index).reset_index(drop=True)
adv_data["adv_Bu"] = tsv(Bu[["firm", "year", "y", "x1", "d1", "d2", "d3", "d4", "d5"]])
c = run_re("adv_re_unb_ydum_robust", Bu, "y", ["x1", "d1", "d2", "d3", "d4", "d5"], "firm", "year", "robust")
c["data"] = "adv_Bu"
adv_cases.append(c)


def lsdv(df, y, xs, ent, tkey):
    """Least squares with every entity and period dummy (numpy lstsq): the slopes, the rank of the design, and the
    classical slope SEs with s² = SSR/(n − rank)."""
    n = len(df)
    ecodes = pd.Categorical(df[ent]).codes
    tcodes = pd.Categorical(df[tkey]).codes
    De = np.eye(ecodes.max() + 1)[ecodes]
    Dt = np.eye(tcodes.max() + 1)[tcodes]
    X = np.column_stack([df[x].values.astype(float) for x in xs] + [np.ones(n), De, Dt])
    b, _, rank, sv = np.linalg.lstsq(X, df[y].values.astype(float), rcond=None)
    e = df[y].values - X @ b
    s2 = float(e @ e) / (n - rank)
    cov = s2 * np.linalg.pinv(X.T @ X)
    return {"params": {x: float(b[j]) for j, x in enumerate(xs)}, "se": {x: float(np.sqrt(cov[j, j])) for j, x in enumerate(xs)}, "rank": int(rank), "df_resid": int(n - rank - 0)}


# Disconnected two-way panels: two groups (the review's case) and three groups of entities in disjoint periods.
dc = mk_panel(40, 8, miss=0.0, singletons=0, seed=3)
kk = dc["firm"].str[1:].astype(int)
dc2 = dc[((kk < 20) & (dc["year"] < 2004)) | ((kk >= 20) & (dc["year"] >= 2004))].reset_index(drop=True)
dc3 = dc[((kk < 12) & (dc["year"] < 2003)) | ((kk >= 12) & (kk < 26) & (dc["year"] >= 2003) & (dc["year"] < 2006)) | ((kk >= 26) & (dc["year"] >= 2006))].reset_index(drop=True)
for key, dfc in [("adv_dc2", dc2), ("adv_dc3", dc3)]:
    adv_data[key] = tsv(dfc[["firm", "year", "y", "x1", "x2"]])
    for se in ["classical", "cluster-entity"]:
        c = run_fe(f"{key}_{se}", dfc, "y", ["x1", "x2"], "firm", "year", "twoway", se)
        c["method"] = "fe_disc"
        c["data"] = key
        c["lsdv"] = lsdv(dfc, "y", ["x1", "x2"], "firm", "year")
        adv_cases.append(c)


# DiD event study where an adopting unit's adoption-period outcome is NA: adoption dated from the RAW treatment column.
def did_panel(N, T, cohorts, seed):
    g = np.random.default_rng(seed)
    rows = []
    for i in range(N):
        a = g.normal() * 2
        cc = cohorts[i]
        for t in range(T):
            d = 1 if (cc is not None and t >= cc) else 0
            x = g.normal()
            yv = 10 + a + 0.5 * t + (2.0 if d else 0) + 0.8 * x + g.normal()
            rows.append(dict(unit=f"U{i:03d}", per=2010 + t, y=yv, D=d, x=x))
    return pd.DataFrame(rows)


def event_true(df_raw, leads, lags, se):
    """Relative period from ranks over all raw rows and the adoption period from the raw D column; then the rows with
    an NA outcome are dropped and the dummies with no row left are removed."""
    d = df_raw.copy()
    tc = {k: i for i, k in enumerate(sorted(d["per"].unique()))}
    d["tc"] = d["per"].map(tc)
    first = d[d["D"] == 1].groupby("unit")["tc"].min()
    d["f"] = d["unit"].map(first)
    names = []
    for r in range(-leads, lags + 1):
        if r == -1:
            continue
        rel = (d["tc"] - d["f"]).clip(-leads, lags)
        d[f"rel_{r}"] = ((rel == r) & d["f"].notna()).astype(float)
        names.append(f"rel_{r}")
    d = d.dropna(subset=["y"]).reset_index(drop=True)
    names = [nm for nm in names if d[nm].sum() > 0]
    return d, names


coh = [4 if i < 12 else None for i in range(30)]
DNA = did_panel(30, 8, coh, 31)
adopt_rows = DNA[(DNA["D"] == 1) & (DNA["per"] == 2014)].index[:6]
DNA.loc[adopt_rows, "y"] = np.nan
adv_data["adv_dna"] = tsv_na(DNA[["unit", "per", "y", "D"]])
evd, evn = event_true(DNA, 3, 3, "cluster-entity")
c = run_fe("adv_event_naadopt_3_3", evd, "y", evn, "unit", "per", "twoway", "cluster-entity")
c["method"] = "event_raw"
c["leads"], c["lags"], c["treat"] = 3, 3, "D"
c["data"] = "adv_dna"
adv_cases.append(c)

data = {
    "bal": tsv(bal),
    "unb": tsv(unb.drop(columns=["qkey"])),
    "nest": tsv(nest),
    "big": tsv(big),
    "reu": tsv(reu),
    "rez": tsv(rez),
    "d22": tsv(d22.drop(columns=["group"])),
    "dcom": tsv(dcom),
    "dst": tsv(dst),
    "rel": tsv(rel),
    "rel_c": tsv(rel_c),
}
which = {
    "fe_bal": "bal", "re_bal": "bal", "fe_unbal": "unb", "fe_cluster": "nest", "fe_scale": "big", "re_unbal": "reu",
    "re_zero": "rez", "re_level": "rel", "re_hq2": "rel_c", "did_2x2": "d22", "did_common": "dcom", "did_stagger": "dst", "event_stagger": "dst", "event_common": "dcom",
}
for c in cases:
    c["data"] = next(v for k, v in which.items() if c["name"].startswith(k))
data.update(adv_data)
cases.extend(adv_cases)
out = {
    "generated_by": "scripts/econ-panel-oracle.py",
    "linearmodels": __import__("linearmodels").__version__,
    "data": data,
    "cases": cases,
    "hausman": {"bal": haus_bal, "reu": haus_reu, "rez": haus_rez, "q2": haus_q2, "adv_classical": haus_adv_classical, "adv_trend": haus_adv_trend, "adv_ydum": haus_adv_ydum},
    "rez_seed": rez_seed,
}
with open(os.path.join(FIX, "econ-panel-oracle.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
print("cases", len(cases), "hausman", out["hausman"], "rez seed", rez_seed)
