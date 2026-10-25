"""Oracle for src/lib/logitProbit.ts: statsmodels Logit/Probit on spector + two seeded datasets.

Writes CSV fixtures and logitProbit-oracle.json into the fixtures dir given as argv[1].
"""
import json
import os
import sys

import numpy as np
import pandas as pd
import scipy
import statsmodels
import statsmodels.api as sm

out = sys.argv[1]

datasets = {}

sp = sm.datasets.spector.load_pandas().data
datasets["spector"] = sp[["GRADE", "GPA", "TUCE", "PSI"]].rename(columns={"GRADE": "grade"})

# Seeded dataset A: n = 400, a continuous, a dummy and a large-scale income column.
rng = np.random.default_rng(20261024)
n = 400
x1 = rng.normal(0, 1, n)
d = (rng.random(n) < 0.4).astype(float)
inc = rng.lognormal(10, 0.5, n)
eta = -0.5 + 0.8 * x1 - 0.6 * d + 0.00004 * inc
y = (rng.random(n) < 1 / (1 + np.exp(-eta))).astype(float)
datasets["simA"] = pd.DataFrame({"buy": y, "x1": np.round(x1, 6), "female": d, "income": np.round(inc, 2)})

# Seeded dataset B: n = 250, unbalanced (about 15% ones), probit truth, two correlated predictors.
rng = np.random.default_rng(777)
n = 250
z1 = rng.normal(0, 1, n)
z2 = 0.6 * z1 + 0.8 * rng.normal(0, 1, n)
eta = -1.2 + 0.7 * z1 - 0.4 * z2
from scipy.stats import norm

y = (rng.random(n) < norm.cdf(eta)).astype(float)
datasets["simB"] = pd.DataFrame({"default": y, "leverage": np.round(z1, 6), "liquidity": np.round(z2, 6)})

# simB with one outlier deep in the tail (row 1: leverage = -20, default = 0): a fitted probability far below 1e-10
# that is NOT separation. The estimates exist and converge; the engine must not call it quasi-separation.
tail = datasets["simB"].copy()
assert tail.iloc[0, 0] == 0
tail.iloc[0, 1] = -20.0
tail.iloc[0, 2] = 0.0
datasets["simBtail"] = tail

for name, df in datasets.items():
    df.to_csv(os.path.join(out, f"logit-{name}.csv"), index=False, float_format="%.10g")


def margeff(res):
    m = res.get_margeff(at="overall", method="dydx")
    return {"names": list(m.summary_frame().index), "me": m.margeff.tolist(), "se": m.margeff_se.tolist(),
            "z": m.tvalues.tolist(), "p": m.pvalues.tolist()}


cases = []
for name, df in datasets.items():
    y = df.iloc[:, 0].to_numpy()
    X = df.iloc[:, 1:]
    for constant in (True, False):
        if not constant and name != "simA":
            continue
        Xd = sm.add_constant(X, prepend=True) if constant else X
        for kind, cls in (("logit", sm.Logit), ("probit", sm.Probit)):
            for se in ("classical", "hc0"):
                kw = {} if se == "classical" else {"cov_type": "HC0"}
                res = cls(y, Xd).fit(method="newton", tol=1e-14, maxiter=200, disp=0, **kw)
                ci = res.conf_int(0.05)
                pred = (res.predict() > 0.5).astype(float)
                cases.append({
                    "dataset": name, "kind": kind, "se": se, "constant": constant,
                    "names": list(Xd.columns),
                    "params": res.params.tolist(), "bse": res.bse.tolist(), "z": res.tvalues.tolist(),
                    "p": res.pvalues.tolist(), "ciLo": ci.iloc[:, 0].tolist(), "ciHi": ci.iloc[:, 1].tolist(),
                    "llf": res.llf, "llnull": res.llnull, "llr": res.llr, "llr_pvalue": res.llr_pvalue,
                    "df_model": res.df_model, "prsquared": res.prsquared, "aic": res.aic, "bic": res.bic,
                    "pcp": float((pred == y).mean()),
                    "margeff": margeff(res),
                })

meta = {"statsmodels": statsmodels.__version__, "scipy": scipy.__version__, "numpy": np.__version__}
with open(os.path.join(out, "logitProbit-oracle.json"), "w") as f:
    json.dump({"meta": meta, "cases": cases}, f, indent=1)
print(len(cases), "cases")
