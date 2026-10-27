"""Oracle for release F1 portfolio & risk (src/lib/portfolioRisk.ts, qpActiveSet.ts) and corporate finance
(src/lib/corpFinance.ts).

Run:  ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/portcorp-oracle.py
Writes src/lib/__tests__/fixtures/portcorp-oracle.json.

Sources:
  performance     numpy (mean, std ddof=1, cumprod wealth index from 1, running max), written here independently.
  CAPM            statsmodels 0.15 OLS of excess returns with a constant: nonrobust, HC1 and HAC
                  (maxlags = floor(4(n/100)^(2/9)), use_correction=True), use_t=True; conf_int at 95%.
  VaR / CVaR      numpy.percentile (method="linear"), scipy.stats.norm / scipy.stats.t (ppf, pdf; t scaled to the
                  sample variance), PCG32 re-implemented with 64-bit integers (pcg_basic.c srandom(seed, 54),
                  self-checked against the pcg-c demo output) + Box-Muller cos branch.
  Markowitz       PyPortfolioOpt 1.6.0 EfficientFrontier(mu, S, weight_bounds=(0, 1)): min_volatility, max_sharpe
                  (risk_free_rate passed explicitly), efficient_return(target); mu = mean * ppy, S = cov(ddof=1) * ppy
                  computed with numpy (NOT expected_returns / risk_models, whose defaults compound and use 252).
  IRR             numpy.roots on sum c_t v^t (v = 1/(1+r)), real v > 0, r in [-0.99, 100]; numpy_financial 1.1
                  irr (one root) as a cross-check; npv, mirr from numpy_financial.
  MIRR            numpy_financial.mirr on Microsoft's MIRR example cash flows (support.microsoft.com MIRR page:
                  -120,000, 39,000, 30,000, 21,000, 37,000, 46,000 at 10% finance / 12% reinvest).
  Payback, PI,    written here from their definitions (linear interpolation within the period; PI = PV(t >= 1)/-CF0;
  EAA, WACC, DCF  EAA = NPV r / (1 - (1+r)^-N); WACC with Hamada; DCF stage by stage).
"""
import json
import math
import os

import numpy as np
import numpy_financial as npf
import statsmodels.api as sm
from scipy import stats
from pypfopt import EfficientFrontier

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "lib", "__tests__", "fixtures", "portcorp-oracle.json")

# ---------------------------------------------------------------------------------------------------------------
# Data (the calculators' defaults, copied from src/lib/portcorpCalcs.ts, plus extra cases)
# ---------------------------------------------------------------------------------------------------------------
CAPM_ROWS = ("-4.33 -2.32|2.10 -0.05|3.25 4.05|-0.28 -1.07|4.46 3.16|1.85 1.30|-0.78 -0.62|-7.23 -6.12|3.53 4.14|8.23 6.55|-5.25 -2.58|-6.60 -6.19|"
             "-0.54 0.80|5.28 5.19|10.69 7.68|0.98 0.64|7.49 2.97|5.99 5.37|7.58 8.08|-0.90 -0.90|6.81 4.29|-8.22 -3.72|2.44 1.56|-3.23 -0.93|"
             "-6.03 -5.59|-3.95 -0.87|1.79 0.43|9.28 2.10|0.45 1.47|5.32 3.12|7.35 6.23|1.88 0.86|-9.08 -7.51|4.22 2.83|10.18 6.73|-1.11 -2.54")
RETURNS = [float(x) for x in ("1.79, 5.72, 5.66, 3.65, 6.74, 0.82, 1.83, 0.61, -4.41, -2.83, -1.20, -3.21, -3.69, 6.03, 3.33, 0.11, -1.59, -1.59, 0.64, -2.28, 0.22, 7.40, -1.16, 2.67, "
                                   "7.44, -7.56, -0.65, 6.68, 0.52, 3.77, -1.49, 3.91, 7.25, 2.89, -0.56, 0.94, -2.46, 2.63, -0.11, 3.74, -0.82, 5.19, -1.61, -0.54, 1.15, -2.23, 5.18, 0.66").split(",")]
FRONTIER_ROWS = ("-2.42 1.86 0.35 1.87|1.29 0.26 3.72 0.08|3.21 1.49 4.65 0.45|2.52 1.02 1.60 3.49|-2.27 0.12 -2.43 -2.32|-2.19 -0.09 -3.33 -1.62|1.45 0.69 -1.65 -1.03|"
                 "1.66 -0.52 -1.78 -2.00|1.73 -0.54 0.81 4.99|4.30 0.41 1.28 0.84|1.39 -0.53 0.94 -3.73|0.06 0.71 0.01 -0.19|-0.80 1.03 -2.24 -0.70|1.64 0.67 -0.54 2.38|"
                 "2.84 0.75 0.90 1.03|-0.62 0.96 1.29 0.88|-1.00 -0.18 3.77 2.11|3.15 0.59 0.83 -1.01|-0.51 -0.06 -2.73 0.70|0.49 0.45 0.62 1.18|2.06 -0.09 2.05 0.62|"
                 "2.53 1.75 2.87 -4.37|2.44 0.17 1.99 2.24|1.09 0.41 1.29 1.22|-2.08 -0.33 -1.90 -1.41|-0.45 1.83 0.27 1.14|-3.99 -0.40 0.29 -2.70|0.77 -0.21 0.74 3.51|"
                 "1.83 0.59 1.32 0.84|2.91 0.46 2.46 1.25|-3.90 -3.18 -4.96 -1.95|-0.62 0.68 0.61 0.62|-1.17 0.86 -2.05 -1.12|2.49 -0.57 0.18 -2.08|0.69 -0.59 -3.31 -1.52|-0.72 0.53 0.70 -0.97")


def rows(packed):
    return [[float(v) for v in r.split()] for r in packed.split("|")]


CAPM = np.array(rows(CAPM_ROWS))
FRONT = np.array(rows(FRONTIER_ROWS))

rng = np.random.default_rng(7)
EXTRA_RET = list(np.round(rng.normal(0.4, 2.0, 120), 3))
# 8 assets, 60 periods: a bigger frontier
C8 = np.diag([16, 9, 4, 25, 1.5, 12, 6, 20]) * 0.5
for i in range(8):
    for j in range(8):
        if i != j:
            C8[i, j] = 0.2 * math.sqrt(C8[i, i] * C8[j, j]) * (1 if (i + j) % 3 else -0.3)
L8 = np.linalg.cholesky(C8)
F8 = np.round(np.array([0.9, 0.6, 0.35, 1.1, 0.2, 0.75, 0.5, 0.95]) + (L8 @ rng.normal(0, 1, (8, 60))).T, 3)


# ---------------------------------------------------------------------------------------------------------------
# Performance and drawdown
# ---------------------------------------------------------------------------------------------------------------
def perf(r_pct, ppy, rf_pct, mar_pct, beta):
    r = np.array(r_pct) / 100
    n = len(r)
    w = np.concatenate([[1.0], np.cumprod(1 + r)])
    peak = np.maximum.accumulate(w)
    dd = w / peak - 1
    t = int(np.argmin(dd))
    p = int(np.argmax(w[: t + 1])) if dd[t] < 0 else 0
    ex = r - rf_pct / 100
    down = np.minimum(r - mar_pct / 100, 0)
    ddev = math.sqrt(np.sum(down ** 2) / n)
    geo = w[-1] ** (ppy / n) - 1
    return {
        "r": list(r_pct), "ppy": ppy, "rf": rf_pct, "mar": mar_pct, "beta": beta,
        "meanAnnual": float(r.mean() * ppy), "geoAnnual": float(geo), "volAnnual": float(r.std(ddof=1) * math.sqrt(ppy)),
        "sharpe": float(ex.mean() / ex.std(ddof=1) * math.sqrt(ppy)),
        "downsideDev": ddev, "sortino": float((r.mean() - mar_pct / 100) * ppy / (ddev * math.sqrt(ppy))),
        "treynor": float(ex.mean() * ppy / beta), "maxDD": float(dd[t]), "peak": p, "trough": t,
        "calmar": float(geo / -dd[t]), "total": float(w[-1] - 1),
    }


# ---------------------------------------------------------------------------------------------------------------
# CAPM
# ---------------------------------------------------------------------------------------------------------------
def capm(ra_pct, rm_pct, rf_pct, ppy, cov):
    ra = np.array(ra_pct) / 100
    rm = np.array(rm_pct) / 100
    rf = rf_pct / 100
    y = ra - rf
    x = rm - rf
    X = sm.add_constant(x, prepend=False)
    n = len(y)
    lag = int(math.floor(4 * (n / 100) ** (2 / 9)))
    if cov == "classical":
        res = sm.OLS(y, X).fit()
    elif cov == "hc1":
        res = sm.OLS(y, X).fit(cov_type="HC1", use_t=True)
    else:
        res = sm.OLS(y, X).fit(cov_type="HAC", use_t=True, cov_kwds={"maxlags": lag, "use_correction": True})
    ci = np.asarray(res.conf_int())
    act = ra - rm
    return {
        "ra": list(ra_pct), "rm": list(rm_pct), "rf": rf_pct, "ppy": ppy, "cov": cov,
        "beta": float(res.params[0]), "betaSe": float(res.bse[0]), "betaT": float(res.tvalues[0]), "betaP": float(res.pvalues[0]),
        "betaLo": float(ci[0, 0]), "betaHi": float(ci[0, 1]),
        "alpha": float(res.params[1]), "alphaSe": float(res.bse[1]), "alphaT": float(res.tvalues[1]), "alphaP": float(res.pvalues[1]),
        "r2": float(res.rsquared),
        "treynor": float(y.mean() * ppy / res.params[0]),
        "infoRatio": float(act.mean() * ppy / (act.std(ddof=1) * math.sqrt(ppy))),
        "varIdio": float(res.ssr / (n - 2) * ppy),
    }


# ---------------------------------------------------------------------------------------------------------------
# VaR
# ---------------------------------------------------------------------------------------------------------------
M64 = (1 << 64) - 1
MULT = 6364136223846793005


class Pcg32:
    def __init__(self, seed, stream=54):
        self.inc = ((stream << 1) | 1) & M64
        self.state = 0
        self.next_u32()
        self.state = (self.state + seed) & M64
        self.next_u32()

    def next_u32(self):
        old = self.state
        self.state = (old * MULT + self.inc) & M64
        xorshifted = (((old >> 18) ^ old) >> 27) & 0xFFFFFFFF
        rot = old >> 59
        return ((xorshifted >> rot) | (xorshifted << ((-rot) & 31))) & 0xFFFFFFFF


_ref = Pcg32(42, 54)
assert [_ref.next_u32() for _ in range(6)] == [0xA15C02B7, 0x7B47F409, 0xBA1D3330, 0x83D2F293, 0xBFA4784B, 0xCBED606E], "PCG32 self-check failed"
TWO32 = 4294967296.0


def hist(r, a):
    q = float(np.percentile(r, a * 100, method="linear"))
    return -q, -float(np.mean(r[r <= q]))


def var_case(r_pct, conf, h, nu, sims, seed):
    r = np.array(r_pct) / 100
    a = 1 - conf / 100
    mu = r.mean()
    sd = r.std(ddof=1)
    hv, hc = hist(r, a)
    sq = math.sqrt(h)
    m, s = mu * h, sd * sq
    z = stats.norm.ppf(a)
    nv = -(m + s * z)
    nc = -(m - s * stats.norm.pdf(z) / a)
    sc = s * math.sqrt((nu - 2) / nu)
    tq = stats.t.ppf(a, nu)
    tv = -(m + sc * tq)
    tc = -(m - sc * stats.t.pdf(tq, nu) / a * (nu + tq ** 2) / (nu - 1))
    # cross-check the closed-form t ES by integration
    es_int = -(m + sc * stats.t.expect(lambda x: x, args=(nu,), ub=tq, conditional=True))
    assert abs(es_int - tc) < 1e-9, (es_int, tc)
    rng_ = Pcg32(seed, 54)
    d = np.empty(sims)
    for i in range(sims):
        u1 = (rng_.next_u32() + 0.5) / TWO32
        u2 = (rng_.next_u32() + 0.5) / TWO32
        d[i] = m + s * math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)
    mv, mc = hist(d, a)
    return {"r": list(r_pct), "conf": conf, "h": h, "nu": nu, "sims": sims, "seed": seed,
            "hist": [hv * sq, hc * sq], "normal": [nv, nc], "t": [tv, tc], "mc": [mv, mc]}


# ---------------------------------------------------------------------------------------------------------------
# Markowitz (PyPortfolioOpt)
# ---------------------------------------------------------------------------------------------------------------
def frontier(R_pct, ppy, rf_pct, targets):
    R = np.asarray(R_pct) / 100
    mu = R.mean(axis=0) * ppy
    S = np.cov(R, rowvar=False, ddof=1) * ppy
    k = R.shape[1]
    rf = rf_pct / 100

    def ef():
        return EfficientFrontier(mu, S, weight_bounds=(0, 1))

    e = ef()
    d = e.min_volatility()
    wmv = np.array([d[i] for i in range(k)])
    e = ef()
    d = e.max_sharpe(risk_free_rate=rf)
    wt = np.array([d[i] for i in range(k)])
    pts = []
    for t in targets:
        e = ef()
        d = e.efficient_return(t)
        w = np.array([d[i] for i in range(k)])
        pts.append({"target": t, "w": list(w), "vol": float(math.sqrt(w @ S @ w))})
    return {"R": R_pct.tolist(), "ppy": ppy, "rf": rf_pct,
            "minVolW": list(wmv), "minVolVar": float(wmv @ S @ wmv), "minVolRet": float(wmv @ mu),
            "tanW": list(wt), "tanSharpe": float((wt @ mu - rf) / math.sqrt(wt @ S @ wt)), "tanVar": float(wt @ S @ wt),
            "points": pts}


# ---------------------------------------------------------------------------------------------------------------
# Capital budgeting
# ---------------------------------------------------------------------------------------------------------------
def all_irr(cfs):
    coeffs = list(reversed(cfs))  # highest power of v first
    while coeffs and coeffs[0] == 0:
        coeffs.pop(0)
    out = []
    for v in np.roots(coeffs):
        if abs(v.imag) < 1e-7 * max(1, abs(v)) and v.real > 0:
            r = 1 / v.real - 1
            if -0.99 <= r <= 100:
                out.append(float(r))
    return sorted(out)


def payback(fl):
    cum = np.cumsum(fl)
    if not fl[0] < 0:
        return None
    for t in range(1, len(fl)):
        if cum[t] >= 0 and cum[t - 1] < 0:
            return float(t - 1 + (-cum[t - 1]) / fl[t])
    return None


def budget(cfs, rate, fr, rr):
    n = len(cfs)
    v = float(npf.npv(rate, cfs))
    disc = [c / (1 + rate) ** t for t, c in enumerate(cfs)]
    life = n - 1
    eaa = v / life if rate == 0 else v * rate / (1 - (1 + rate) ** -life)
    m = npf.mirr(cfs, fr, rr)
    one = npf.irr(cfs)
    return {"cfs": cfs, "rate": rate, "fr": fr, "rr": rr, "npv": v, "irrs": all_irr(cfs),
            "npfIrr": None if np.isnan(one) else float(one),
            "mirr": None if np.isnan(m) else float(m), "payback": payback(cfs), "dpayback": payback(disc),
            "pi": float((v - cfs[0]) / -cfs[0]) if cfs[0] < 0 else None, "eaa": float(eaa)}


def wacc_case(E, D, rd, tax, rf, mrp, beta, kind, peer_de=0.0, peer_tax=None):
    t = tax / 100
    de = D / E
    if kind == "levered":
        bl = beta
        bu = beta / (1 + (1 - t) * de)
    elif kind == "unlevered":
        bu = beta
        bl = bu * (1 + (1 - t) * de)
    else:
        pt = (tax if peer_tax is None else peer_tax) / 100
        bu = beta / (1 + (1 - pt) * peer_de)
        bl = bu * (1 + (1 - t) * de)
    re = rf / 100 + bl * mrp / 100
    V = E + D
    w = E / V * re + D / V * rd / 100 * (1 - t)
    return {"in": [E, D, rd, tax, rf, mrp, beta, kind, peer_de, peer_tax], "betaU": bu, "betaL": bl, "re": re, "wacc": w}


def dcf_case(fcf, wacc, fade, fade_start, terminal, g, multiple, metric, mid, net_debt, shares):
    w = wacc / 100
    off = 0.5 if mid else 0.0
    pv_e = sum(c / (1 + w) ** (i + 1 - off) for i, c in enumerate(fcf))
    last = fcf[-1]
    pv_f = 0.0
    N = len(fcf)
    for k in range(1, fade + 1):
        gk = fade_start / 100 + (g / 100 - fade_start / 100) * (k - 1) / fade
        last *= 1 + gk
        pv_f += last / (1 + w) ** (N + k - off)
    T = N + fade
    if terminal == "gordon":
        tv = last * (1 + g / 100) / (w - g / 100)
        tt = T - off
    else:
        tv = multiple * (last if metric is None else metric)
        tt = T
    pv_tv = tv / (1 + w) ** tt
    ev = pv_e + pv_f + pv_tv
    eq = ev - net_debt
    return {"in": [fcf, wacc, fade, fade_start, terminal, g, multiple, metric, mid, net_debt, shares],
            "pvExplicit": pv_e, "pvFade": pv_f, "tv": tv, "pvTv": pv_tv, "ev": ev, "equity": eq,
            "perShare": None if shares is None else eq / shares}


def frontier_fuzz():
    """Random long-only problems straight from (mu, S), including equal and nearly equal means (the active-set
    method cycled on equal means before the F1 adversarial fix) and strongly correlated assets."""
    g = np.random.default_rng(20261027)
    cases = []
    for c in range(40):
        k = int(g.integers(2, 11))
        A = g.normal(0, 1, (k, k))
        corr = 0.95 if c % 5 == 4 else 0.0
        S = (A @ A.T) / k * 0.02 + np.eye(k) * 0.002
        if corr:
            d = np.sqrt(np.diag(S))
            S = corr * np.outer(d, d) + (1 - corr) * np.diag(d * d)
        mu = g.uniform(0.02, 0.15, k)
        if c % 4 == 1:
            mu[: max(2, k // 2)] = mu[0]  # exactly equal means
        if c % 4 == 2:
            mu = mu[0] + g.uniform(0, 1e-3, k)  # nearly equal means
        rf = float(min(mu) - 0.01) if c % 3 else 0.02
        if not (mu > rf).any():
            rf = float(min(mu) - 0.01)
        try:
            e = EfficientFrontier(mu, S, weight_bounds=(0, 1))
            d1 = e.min_volatility()
            wmv = np.array([d1[i] for i in range(k)])
            e = EfficientFrontier(mu, S, weight_bounds=(0, 1))
            d2 = e.max_sharpe(risk_free_rate=rf)
            wt = np.array([d2[i] for i in range(k)])
            lo, hi = float(wmv @ mu), float(mu.max())
            tg = lo + 0.6 * (hi - lo)
            e = EfficientFrontier(mu, S, weight_bounds=(0, 1))
            d3 = e.efficient_return(tg)
            we = np.array([d3[i] for i in range(k)])
        except Exception as ex:  # cvxpy gives up on a few nearly-equal-mean problems: recorded, not used
            print("fuzz case", c, "skipped: PyPortfolioOpt", type(ex).__name__)
            continue
        # cvxpy returns weights up to about -1e-6 (slightly infeasible), which can overstate the Sharpe ratio; the same
        # weights clipped at 0 and renormalised are feasible, so the true optimum can be no worse than them.
        def proj(w):
            w = np.clip(w, 0, None)
            return w / w.sum()
        pmv, pt = proj(wmv), proj(wt)
        cases.append({"mu": list(mu), "S": S.tolist(), "rf": rf, "minVolVar": float(wmv @ S @ wmv),
                      "minVolVarFeasible": float(pmv @ S @ pmv), "tanSharpeFeasible": float((pt @ mu - rf) / math.sqrt(pt @ S @ pt)),
                      "tanSharpe": float((wt @ mu - rf) / math.sqrt(wt @ S @ wt)), "target": tg, "targetVar": float(we @ S @ we)})
    return cases


def main():
    out = {}
    out["frontierFuzz"] = frontier_fuzz()
    out["perf"] = [perf(RETURNS, 12, 0.25, 0.0, 1.1), perf(EXTRA_RET, 52, 0.05, 0.1, 0.8), perf(list(FRONT[:, 0]), 12, 0.0, -0.5, 1.3)]
    out["capm"] = [capm(CAPM[:, 0], CAPM[:, 1], 0.25, 12, c) for c in ("classical", "hc1", "hac")]
    out["var"] = [var_case(RETURNS, 95, 1, 5, 20000, 1), var_case(RETURNS, 99, 10, 4, 5000, 123456789), var_case(EXTRA_RET, 97.5, 1, 30, 1000, 0)]
    out["frontier"] = [frontier(FRONT, 12, 3.0, [0.04, 0.05, 0.06]), frontier(F8, 12, 2.0, [0.05, 0.08, 0.11])]
    flows = [
        ([-1000, 300, 400, 500, 200], 0.10, 0.10, 0.12),
        ([-1000, 600, 400, 200, 100], 0.10, 0.10, 0.12),
        ([-120000, 39000, 30000, 21000, 37000, 46000], 0.10, 0.10, 0.12),  # Microsoft MIRR page example flows (numpy-financial: 12.61%)
        ([-120000, 39000, 30000, 21000], 0.10, 0.10, 0.12),  # Microsoft MIRR page example flows (numpy-financial: -4.80%)
        ([-120000, 39000, 30000, 21000, 37000, 46000], 0.10, 0.10, 0.14),  # Microsoft MIRR page example flows (numpy-financial: 13.48%)
        ([-1600, 10000, -10000], 0.10, 0.10, 0.10),  # two IRRs: 25% and 400%
        ([-1, 6, -11, 6], 0.10, 0.10, 0.10),  # (1 - v)(2v... ) roots v = 1, 1/2, 1/3: 0%, 100%, 200%
        ([-100, 230, -132], 0.05, 0.05, 0.05),  # roots 10% and 20%
        ([-1000] + [120] * 30, 0.08, 0.08, 0.08),
        ([100, 50, 25], 0.10, 0.10, 0.10),  # no sign change
    ]
    out["budget"] = [budget(c, r, f, rr) for c, r, f, rr in flows]
    out["msMirr"] = [round(npf.mirr(flows[2][0], 0.10, 0.12), 4), round(npf.mirr(flows[3][0], 0.10, 0.12), 4), round(npf.mirr(flows[4][0], 0.10, 0.14), 4)]
    out["wacc"] = [wacc_case(6000, 2000, 6, 25, 4.2, 5.5, 1.1, "levered"), wacc_case(6000, 2000, 6, 25, 4.2, 5.5, 0.9, "unlevered"),
                   wacc_case(5000, 3000, 7, 21, 3.5, 6, 1.3, "peer", 0.8, 30), wacc_case(1000, 0, 5, 30, 4, 5, 1.0, "levered")]
    out["dcf"] = [
        dcf_case([100, 110, 120, 128, 135], 9, 5, 6, "gordon", 2.5, 10, None, False, 300, 50),
        dcf_case([100, 110, 120, 128, 135], 9, 5, 6, "gordon", 2.5, 10, None, True, 300, 50),
        dcf_case([100, 110, 120, 128, 135], 9, 0, 2.5, "exit", 2.5, 10, 220, True, 300, None),
        dcf_case([-50, 20, 60, 90], 11, 3, 8, "exit", 2, 8, None, False, -100, 10),
    ]
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", OUT)
    print("MS MIRR", out["msMirr"])
    print("IRRs", [b["irrs"] for b in out["budget"]])


main()
