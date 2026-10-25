"""
Independent numpy oracle for the es-event calculator (Release E3c): a market-model event study written straight
from the matrix formulas of Campbell, Lo & MacKinlay (1997), The Econometrics of Financial Markets, section 4.4
(eqs. 4.4.1-4.4.24) and MacKinlay (1997), J. Econ. Lit. 35(1), with no code shared with src/lib/eventStudy.ts:

  theta_hat = (X'X)^-1 X'R over the estimation window (X = [1, Rm]),  sigma2 = e'e / (L1 - 2)
  AR*  = R* - X* theta_hat                         (event window, X* = [1, Rm*])
  V    = sigma2 * (I + X* (X'X)^-1 X*')            (formed explicitly as an L2 x L2 matrix)
  CAR  = g'AR*, var = g'Vg, SCAR = CAR / sqrt(var), p from Student t(L1 - 2)
  J1   = mean CAR / sqrt(sum var / N^2)            p from N(0,1)
  J2   = sqrt(N (L1-4)/(L1-2)) * mean SCAR         p from N(0,1)
  BMP  = mean SCAR * sqrt(N) / sd(SCAR, ddof=1)    p from t(N - 1)
  CS   = mean CAR / sqrt(sum (CAR - mean)^2 / N^2) p from N(0,1)   (MacKinlay eq. 21)

Data: synthetic, numpy default_rng with fixed seeds; dates are weekdays (trading days). Every number is written to
the fixture as the decimal string the calculator reads, and the oracle computes from float(that string).

Run: jurislab-oracle-venv python scripts/econ-event-study-oracle.py
(writes src/lib/__tests__/fixtures/econ-event-study-oracle.json)
"""
import datetime as dt
import json
import os

import numpy as np
from scipy import stats

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "__tests__", "fixtures", "econ-event-study-oracle.json")


def weekdays(start, n):
    out = []
    d = start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += dt.timedelta(days=1)
    return out


def make_returns(seed, n, firms, start, shocks):
    rng = np.random.default_rng(seed)
    dates = weekdays(start, n)
    m = 0.0003 + 0.01 * rng.standard_normal(n)
    cols = {"Market": m}
    for k, f in enumerate(firms):
        beta = 0.6 + 0.3 * k
        cols[f] = 0.0001 * (k + 1) + beta * m + (0.008 + 0.003 * k) * rng.standard_normal(n)
    for (f, day, size) in shocks:
        i = next(j for j, d in enumerate(dates) if d >= day)
        cols[f][i] += size
    return dates, cols


def table_text(dates, cols, fmt):
    names = list(cols.keys())
    lines = ["Date\t" + "\t".join(names)]
    strs = {k: [fmt(v) for v in cols[k]] for k in names}
    for i, d in enumerate(dates):
        lines.append(d.isoformat() + "\t" + "\t".join(strs[k][i] for k in names))
    values = {k: np.array([float(s) for s in strs[k]]) for k in names}
    return "\n".join(lines), values


def study(dates, values, market, events, input_kind, est, ev):
    names = list(values.keys())
    if input_kind == "returns":
        R = values
        rdates = dates
    else:
        R = {}
        for k in names:
            p = values[k]
            R[k] = np.log(p[1:] / p[:-1]) if input_kind == "log" else p[1:] / p[:-1] - 1.0
        rdates = dates[1:]
    rm = R[market]
    e0, e1 = est
    t1, t2 = ev
    L1 = e1 - e0 + 1
    L2 = t2 - t1 + 1
    per = []
    for firm, day in events:
        row = next(j for j, d in enumerate(rdates) if d >= day)
        ri = R[firm]
        Xe = np.column_stack([np.ones(L1), rm[row + e0: row + e1 + 1]])
        Re = ri[row + e0: row + e1 + 1]
        XtXi = np.linalg.inv(Xe.T @ Xe)
        th = XtXi @ Xe.T @ Re
        resid = Re - Xe @ th
        s2 = float(resid @ resid) / (L1 - 2)
        Xs = np.column_stack([np.ones(L2), rm[row + t1: row + t2 + 1]])
        ar = ri[row + t1: row + t2 + 1] - Xs @ th
        V = s2 * (np.eye(L2) + Xs @ XtXi @ Xs.T)

        def window(a, b):
            g = np.zeros(L2)
            g[a - t1: b - t1 + 1] = 1.0
            car = float(g @ ar)
            var = float(g @ V @ g)
            scar = car / np.sqrt(var)
            return {"car": car, "var": var, "scar": scar, "p": float(2 * stats.t.sf(abs(scar), L1 - 2))}

        rec = {
            "firm": firm,
            "day_used": rdates[row].isoformat(),
            "alpha": float(th[0]),
            "beta": float(th[1]),
            "sigma2": s2,
            "ar": [float(x) for x in ar],
            "Vdiag": [float(x) for x in np.diag(V)],
            "main": window(t1, t2),
            "cum": [window(t1, t1 + k)["var"] for k in range(L2)],
        }
        if t1 <= -1 and t2 >= 1 and not (t1 == -1 and t2 == 1):
            rec["car11"] = window(-1, 1)
        per.append(rec)
    N = len(per)

    def agg(key):
        cars = np.array([e[key]["car"] for e in per])
        vars_ = np.array([e[key]["var"] for e in per])
        scars = np.array([e[key]["scar"] for e in per])
        out = {}
        j1 = cars.mean() / np.sqrt(vars_.sum() / N**2)
        out["J1"] = [float(j1), float(2 * stats.norm.sf(abs(j1)))]
        j2 = np.sqrt(N * (L1 - 4) / (L1 - 2)) * scars.mean()
        out["J2"] = [float(j2), float(2 * stats.norm.sf(abs(j2)))]
        if N >= 2:
            bmp = scars.mean() * np.sqrt(N) / scars.std(ddof=1)
            out["BMP"] = [float(bmp), float(2 * stats.t.sf(abs(bmp), N - 1))]
            cs = cars.mean() / np.sqrt(((cars - cars.mean()) ** 2).sum() / N**2)
            out["CS"] = [float(cs), float(2 * stats.norm.sf(abs(cs)))]
        return out

    aar = np.mean([e["ar"] for e in per], axis=0)
    caar = np.cumsum(aar)
    se = np.sqrt(np.sum([e["cum"] for e in per], axis=0)) / N
    res = {
        "L1": L1,
        "events": per,
        "aar": [float(x) for x in aar],
        "caar": [float(x) for x in caar],
        "caar_se": [float(x) for x in se],
        "tests_main": agg("main"),
    }
    if "car11" in per[0]:
        res["tests_11"] = agg("car11")
    return res


def tau(t):
    return str(t).replace("-", "−")


cases = []

# 1. Returns, three firms, four events (one on a Saturday, so it moves to Monday), MacKinlay's default-like windows.
d0 = dt.date(2023, 1, 2)
dates, cols = make_returns(11, 320, ["Alpha", "Beta", "Gamma"], d0, [])
evs = [("Alpha", dt.date(2023, 9, 14)), ("Beta", dt.date(2023, 10, 7)), ("Gamma", dt.date(2023, 11, 20)), ("Alpha", dt.date(2024, 1, 5))]
for (f, day), size in zip(evs, [0.03, -0.02, 0.015, 0.01]):
    i = next(j for j, d in enumerate(dates) if d >= day)
    cols[f][i] += size
text, values = table_text(dates, cols, lambda v: f"{v:.6f}")
cases.append({
    "name": "returns_4events",
    "fields": {"input": "returns", "est_from": tau(-130), "est_to": tau(-11), "ev_from": tau(-5), "ev_to": "5", "market": ""},
    "data": text,
    "events": "\n".join(f"{f}: {d.isoformat()}" for f, d in evs),
    "expect": study(dates, values, "Market", evs, "returns", (-130, -11), (-5, 5)),
})

# 2 and 3. Prices (simple and log returns), two firms, the market column last and named, custom windows.
rng = np.random.default_rng(29)
n = 260
pdates = weekdays(dt.date(2022, 3, 1), n)
rm = 0.0002 + 0.011 * rng.standard_normal(n)
ra = 0.9 * rm + 0.012 * rng.standard_normal(n)
rb = 1.3 * rm + 0.009 * rng.standard_normal(n)
ra[200] += 0.04
rb[230] -= 0.03
pcols = {"Firm A": 50 * np.cumprod(1 + ra), "Firm B": 20 * np.cumprod(1 + rb), "Index": 1000 * np.cumprod(1 + rm)}
ptext, pvalues = table_text(pdates, pcols, lambda v: f"{v:.4f}")
pevs = [("Firm A", pdates[200]), ("Firm B", pdates[230])]
for kind in ["simple", "log"]:
    cases.append({
        "name": f"prices_{kind}",
        "fields": {"input": kind, "est_from": tau(-100), "est_to": tau(-6), "ev_from": tau(-2), "ev_to": "3", "market": "Index"},
        "data": ptext,
        "events": "\n".join(f"{f}: {d.isoformat()}" for f, d in pevs),
        "expect": study(pdates, pvalues, "Index", pevs, kind, (-100, -6), (-2, 3)),
    })

# 4. One firm, one event given by date alone, a one-day event window (no CAR(-1, +1)), L1 = 60.
dates4, cols4 = make_returns(5, 120, ["Solo"], dt.date(2024, 2, 1), [])
ev4 = [("Solo", dates4[90])]
cols4["Solo"][90] += 0.05
text4, values4 = table_text(dates4, cols4, lambda v: f"{v:.7f}")
cases.append({
    "name": "single_event",
    "fields": {"input": "returns", "est_from": tau(-70), "est_to": tau(-11), "ev_from": "0", "ev_to": "0", "market": ""},
    "data": text4,
    "events": dates4[90].isoformat(),
    "expect": study(dates4, values4, "Market", ev4, "returns", (-70, -11), (0, 0)),
})

with open(OUT, "w", encoding="utf-8") as fh:
    json.dump({"source": "scripts/econ-event-study-oracle.py (numpy " + np.__version__ + ", scipy)", "cases": cases}, fh, indent=1, ensure_ascii=False)
print("wrote", OUT, len(cases), "cases")
