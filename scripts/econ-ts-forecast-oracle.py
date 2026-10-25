"""
Oracle for Release E3b: ARIMA(p, d, q) and Holt-Winters exponential smoothing (statsmodels 0.15).

All data are synthetic, generated here with fixed seeds (numpy default_rng), so nothing copyrighted ships. The doubles
are written to the JSON with Python's repr, which round-trips exactly.

ARIMA. The convention matched is SIMPLE DIFFERENCING: the exact Gaussian likelihood of the stationary ARMA(p, q) on
w = (1 - L)^d y, with a MEAN mu (y_t - mu follows the ARMA; the form statsmodels' ARIMA and R's arima print), not the
SARIMAX intercept c = mu (1 - sum phi). The oracle model is ARIMA(w, order=(p, 0, q), trend='c' or 'n'), and the script
asserts that SARIMAX(y, (p, d, q), simple_differencing=True, trend='c') at the mapped intercept gives the same llf.
statsmodels' DEFAULT ARIMA(y, (p, d, q)) puts the d integrated states in an approximate-diffuse prior (variance 1e6), so
its llf differs from the simple-differencing llf by about 1e-8 relative at unit scale and by a large amount when the
series is in the millions (the prior is then not diffuse at all); both numbers are recorded as `defaultLlf*` so the
report can quote them. Level forecasts and their standard errors come from SARIMAX(..., use_exact_diffuse=True) at the
oracle parameters (exact diffuse: the integrated states are learned exactly from the data), whose llf the script
asserts is the simple-differencing llf minus d/2 log(2 pi) at two different parameter vectors.
Drift (d = 1): ARIMA's trend 't' is the exog column t = 1..n, i.e. a regression with ARIMA errors; on w it is the mean
of the differences, so the oracle fits ARIMA(w, trend='c') and forecasts with SARIMAX(y, exog=t, use_exact_diffuse).
SEs: cov_type='approx' (numerical Hessian of the llf in the constrained parameters; statsmodels' default is 'opg').
Ljung-Box: acorr_ljungbox on the standardized forecast errors, lags = min(10, nobs // 5), model_df = p + q.

Holt-Winters. ExponentialSmoothing(trend, damped_trend, seasonal, seasonal_periods, initialization_method='estimated')
.fit() with its defaults (brute grid then L-BFGS-B). Recorded: the fitted smoothing parameters and initial states (the
params dict; its `initial_trend` is the internal b0), SSE, fitted values, its forecasts, AIC/AICc/BIC.
statsmodels 0.15's ExponentialSmoothing forecast at horizons h = m, 2m, ... uses the seasonal state from one cycle
too early (`s[nobs + m - 1:] = [s[(nobs - 1) + j % m] ...]` overwrites the seasonal updated by the last observation).
ETSModel at the mapped parameters (beta_ets = alpha * beta_hw, gamma the same, initial seasonals in reverse order)
reproduces the ExponentialSmoothing fitted values to ~1e-14 and forecasts every horizon by the textbook formula
(Hyndman et al. 2008); the fixture records both, and the jest pins use ETSModel for all horizons and
ExponentialSmoothing for h not divisible by m. Analytic prediction variances (additive-error models only): ETSModel's
mse * _relative_forecast_variance (mse = SSE / n), cross-checked here against the general class-1 formula
sigma^2 [1 + sum_{j<h} c_j^2], c_j = alpha + beta_ets phi_j + gamma 1{j mod m = 0}.

Run: jurislab-oracle-venv python scripts/econ-ts-forecast-oracle.py
(writes src/lib/__tests__/fixtures/econ-ts-forecast-oracle.json)
"""
import json, math, os, warnings
import numpy as np
import pandas as pd
from scipy.stats import norm
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.statespace.sarimax import SARIMAX
from statsmodels.tsa.holtwinters import ExponentialSmoothing
from statsmodels.tsa.exponential_smoothing.ets import ETSModel
from statsmodels.stats.diagnostic import acorr_ljungbox

warnings.simplefilter("ignore")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "__tests__", "fixtures", "econ-ts-forecast-oracle.json")
H = 8
Z975 = float(norm.ppf(0.975))


def arma_sim(rng, n, phi, theta, sigma, burn=200):
    e = rng.normal(0, sigma, n + burn)
    x = np.zeros(n + burn)
    for t in range(n + burn):
        v = e[t]
        for i, f in enumerate(phi):
            if t - 1 - i >= 0:
                v += f * x[t - 1 - i]
        for j, th in enumerate(theta):
            if t - 1 - j >= 0:
                v += th * e[t - 1 - j]
        x[t] = v
    return x[burn:]


def integrate(w, d, start):
    y = np.array(w, dtype=float)
    for _ in range(d):
        y = np.cumsum(np.r_[start, y])
    return y


def fl(a):
    return [float(v) for v in np.asarray(a, dtype=float).ravel()]


def arima_case(name, y, p, d, q, trend, rescale=1.0):
    """trend: 'mean' (d = 0), 'drift' (d = 1) or 'none'.

    rescale: statsmodels optimises in raw units, and on a series in the millions its L-BFGS stops short of the maximum
    (restarting from its own answer does not move it). For such a case the oracle fits w / rescale, maps the parameters
    back (mu * rescale, sigma2 * rescale^2, SEs likewise) and asserts the raw-scale llf at the mapped parameters equals
    the rescaled llf - N log(rescale). The raw-scale fit's llf is kept as firstFitLlf for the report.
    """
    y = np.asarray(y, dtype=float)
    n = len(y)
    w = np.diff(y, n=d) if d else y.copy()
    tr = "c" if trend in ("mean", "drift") else "n"
    k = 1 if tr == "c" else 0
    mod = ARIMA(w, order=(p, 0, q), trend=tr)
    res = mod.fit(cov_type="approx")
    first_llf = float(res.llf)
    refits = 0
    for _ in range(20):
        r2 = mod.fit(start_params=res.params, cov_type="approx")
        if r2.llf > res.llf + 1e-10:
            res = r2
            refits += 1
        else:
            break
    bse = res.bse
    if rescale != 1.0:
        rmod = ARIMA(w / rescale, order=(p, 0, q), trend=tr)
        rres = rmod.fit(cov_type="approx")
        jac = np.r_[([rescale] if k else []), np.ones(p + q), rescale ** 2]
        res = mod.filter(rres.params * jac)
        assert abs(res.llf - (rres.llf - len(w) * math.log(rescale))) < 1e-9 * abs(res.llf), name
        assert res.llf > first_llf, name
        bse = rres.bse * jac
    params = res.params.copy()
    names = list(mod.param_names)
    # params order: [const?] ar.L1.. ma.L1.. sigma2
    k = 1 if tr == "c" else 0
    mu = float(params[0]) if k else 0.0
    phi = params[k:k + p]
    theta = params[k + p:k + p + q]
    sigma2 = float(params[-1])

    # SARIMAX simple_differencing with the intercept form gives the same likelihood.
    sd = SARIMAX(y, order=(p, d, q), trend=tr, simple_differencing=True)
    sd_params = np.r_[([mu * (1 - np.sum(phi))] if k else []), phi, theta, sigma2]
    llf_sd = float(sd.loglike(sd_params))
    assert abs(llf_sd - res.llf) < 1e-9 * abs(res.llf), (name, llf_sd, res.llf)

    # A second parameter vector for the likelihood-function pin.
    p2 = params.copy()
    if p:
        p2[k] = params[k] * 0.8
    if q:
        p2[k + p] = params[k + p] * 0.7 + 0.05
    if k:
        p2[0] = params[0] + 0.1 * math.sqrt(sigma2)
    p2[-1] = sigma2 * 1.3
    llf2 = float(mod.loglike(p2))
    # statsmodels freezes its filter once P looks converged (ssm.tolerance = 1e-19); on short series that freeze can
    # move the llf by ~1e-8. The exact filter (tolerance 0) is what the 1e-9 pin compares with; both are recorded.
    mod.ssm.tolerance = 0
    llf_exact = float(mod.loglike(params))
    llf2_exact = float(mod.loglike(p2))
    mod.ssm.tolerance = 1e-19

    # Level forecasts by exact diffuse SARIMAX at the oracle parameters.
    if d == 0:
        fr = res.get_forecast(H)
        fmean, fse = fr.predicted_mean, fr.se_mean
    else:
        if trend == "drift":
            ex = np.arange(1, n + 1, dtype=float)[:, None]
            ed = SARIMAX(y, order=(p, d, q), exog=ex, use_exact_diffuse=True)
            ep = np.r_[mu, phi, theta, sigma2]
            ep2 = np.r_[p2[0], p2[k:]]
            fr = ed.filter(ep).get_forecast(H, exog=np.arange(n + 1, n + H + 1, dtype=float)[:, None])
        else:
            ed = SARIMAX(y, order=(p, d, q), use_exact_diffuse=True)
            ep = np.r_[phi, theta, sigma2]
            ep2 = p2[k:]
            fr = ed.filter(ep).get_forecast(H)
        off1 = float(ed.loglike(ep)) - res.llf
        off2 = float(ed.loglike(ep2)) - llf2
        assert abs(off1 - off2) < 1e-8 and abs(off1 + d * 0.5 * math.log(2 * math.pi)) < 1e-7, (name, off1, off2)
        fmean, fse = fr.predicted_mean, fr.se_mean

    # statsmodels' default (approximate diffuse) ARIMA, for the report.
    dflt = {}
    if d:
        dm = ARIMA(y, order=(p, d, q), trend=("t" if trend == "drift" else "n"))
        dflt["defaultLlfAtOracle"] = float(dm.loglike(np.r_[([mu] if trend == "drift" else []), phi, theta, sigma2]))
        dflt["defaultFitLlf"] = float(dm.fit().llf)

    sr = res.standardized_forecasts_error[0]
    lags = min(10, len(w) // 5)
    lb = acorr_ljungbox(sr, lags=[lags], model_df=p + q)
    return {
        "name": name,
        "y": fl(y),
        "p": p, "d": d, "q": q, "trend": trend,
        "paramNames": names,
        "mu": mu, "phi": fl(phi), "theta": fl(theta), "sigma2": sigma2,
        "se": fl(bse),
        "llf": float(res.llf),
        "aic": float(res.aic), "aicc": float(res.aicc), "bic": float(res.bic),
        "nobs": int(res.nobs),
        "firstFitLlf": first_llf, "refits": refits,
        "params2": {"mu": float(p2[0]) if k else 0.0, "phi": fl(p2[k:k + p]), "theta": fl(p2[k + p:k + p + q]),
                    "sigma2": float(p2[-1])},
        "llf2": llf2,
        "llfExactFilter": llf_exact, "llf2ExactFilter": llf2_exact,
        "ljungBox": {"lags": int(lags), "q": float(lb["lb_stat"].iloc[0]), "p": float(lb["lb_pvalue"].iloc[0])},
        "forecast": fl(fmean), "forecastSe": fl(fse),
        "lower": fl(np.asarray(fmean) - Z975 * np.asarray(fse)), "upper": fl(np.asarray(fmean) + Z975 * np.asarray(fse)),
        **dflt,
    }


def class1_variance(alpha, beta, gamma, phi, m, h, mse, has_trend, damped, has_seasonal):
    out = []
    for hh in range(1, h + 1):
        s = 1.0
        for j in range(1, hh):
            c = alpha
            if has_trend:
                phij = sum(phi ** i for i in range(1, j + 1)) if damped else j
                c += beta * phij
            if has_seasonal and j % m == 0:
                c += gamma
            s += c * c
        out.append(mse * s)
    return np.array(out)


def hw_sim(rng, n, alpha, beta, gamma, phi, s0, l0, b0, sigma, trend, seasonal):
    """y from the Holt-Winters error-correction recursions (statsmodels' form) with N(0, sigma^2) one-step errors."""
    m = len(s0)
    s = list(s0)
    l, b = l0, b0
    y = []
    for i in range(n):
        base = l + (phi * b if trend else 0.0)
        f = base * s[i] if seasonal == "mul" else base + s[i]
        yi = f + rng.normal(0, sigma)
        y.append(yi)
        if seasonal == "mul":
            ln = alpha * yi / s[i] + (1 - alpha) * base
            s.append(gamma * yi / base + (1 - gamma) * s[i])
        else:
            ln = alpha * (yi - s[i]) + (1 - alpha) * base
            s.append(gamma * (yi - base) + (1 - gamma) * s[i])
        if trend:
            b = beta * (ln - l) + (1 - beta) * phi * b
        l = ln
    return np.array(y)


def ets_case(name, y, trend, damped, seasonal, m):
    y = np.asarray(y, dtype=float)
    n = len(y)
    mod = ExponentialSmoothing(y, trend=trend, damped_trend=damped, seasonal=seasonal,
                               seasonal_periods=(m if seasonal else None), initialization_method="estimated")
    r = mod.fit()
    pr = r.params
    alpha = float(pr["smoothing_level"])
    beta = float(pr["smoothing_trend"]) if trend else 0.0
    gamma = float(pr["smoothing_seasonal"]) if seasonal else 0.0
    phi = float(pr["damping_trend"]) if damped else 1.0
    l0 = float(pr["initial_level"])
    b0 = float(pr["initial_trend"]) if trend else 0.0
    s0 = fl(pr["initial_seasons"]) if seasonal else []
    h = H if not seasonal else max(H, 2 * m + 1)
    fc_hw = r.forecast(h)

    # ETSModel at the mapped parameters: same fitted values, textbook forecasts, analytic variances.
    # (a pandas Series: ETSModel.get_prediction fails on a bare ndarray in 0.15)
    em = ETSModel(pd.Series(y), error="add", trend=("add" if trend else None), damped_trend=damped,
                  seasonal=(seasonal if seasonal else None), seasonal_periods=(m if seasonal else None))
    vals = {"smoothing_level": alpha, "smoothing_trend": alpha * beta, "smoothing_seasonal": gamma,
            "damping_trend": phi, "initial_level": l0, "initial_trend": b0}
    pv = []
    for nm in em.param_names:
        if nm.startswith("initial_seasonal."):
            pv.append(s0[::-1][int(nm.split(".")[1])])
        else:
            pv.append(vals[nm])
    er = em.smooth(np.array(pv))
    assert np.max(np.abs(np.asarray(er.fittedvalues) - np.asarray(r.fittedvalues))) < 1e-9 * max(1.0, np.max(np.abs(y))), name
    fc_ets = np.asarray(er.forecast(h))
    sse = float(r.sse)
    out = {
        "name": name, "y": fl(y), "trend": trend or "none", "damped": bool(damped), "seasonal": seasonal or "none",
        "m": m if seasonal else 0,
        "alpha": alpha, "beta": beta, "gamma": gamma, "phi": phi, "l0": l0, "b0": b0, "s0": s0,
        "sse": sse, "fitted": fl(r.fittedvalues),
        "forecastHw": fl(fc_hw), "forecastEts": fl(fc_ets),
        "aic": float(r.aic), "aicc": float(r.aicc), "bic": float(r.bic),
    }
    if seasonal != "mul":
        pred = er.get_prediction(start=n, end=n + h - 1)
        var = np.asarray(pred.forecast_variance, dtype=float)
        mine = class1_variance(alpha, alpha * beta, gamma, phi, m, h, sse / n, bool(trend), damped, bool(seasonal))
        assert np.max(np.abs(var - mine) / mine) < 1e-10, (name, var, mine)
        out["forecastVar"] = fl(var)
        out["lower"] = fl(np.asarray(fc_ets) - Z975 * np.sqrt(var))
        out["upper"] = fl(np.asarray(fc_ets) + Z975 * np.sqrt(var))
    return out


def main():
    arima = []
    rng = np.random.default_rng(20261025)
    x = arma_sim(rng, 260, [0.6], [0.3], 1.0) + 5.0
    arima.append(arima_case("arma11_mean", x, 1, 0, 1, "mean"))

    rng = np.random.default_rng(20261026)
    w = arma_sim(rng, 300, [0.5, -0.3], [0.4], 2.0)
    arima.append(arima_case("arima211_nodrift", integrate(w, 1, 100.0), 2, 1, 1, "none"))

    rng = np.random.default_rng(20261027)
    w = arma_sim(rng, 250, [0.4], [-0.5], 0.5) + 0.3
    arima.append(arima_case("arima111_drift", integrate(w, 1, 20.0), 1, 1, 1, "drift"))

    rng = np.random.default_rng(20261028)
    w = arma_sim(rng, 240, [], [-0.6, 0.2], 1.0)
    arima.append(arima_case("arima022", integrate(integrate(w, 1, 0.5), 1, 10.0), 0, 2, 2, "none"))

    rng = np.random.default_rng(20261029)
    x = arma_sim(rng, 300, [0.5, 0.2, -0.25], [], 3.0) + 40.0
    arima.append(arima_case("ar3_mean", x, 3, 0, 0, "mean"))

    rng = np.random.default_rng(20261030)
    x = arma_sim(rng, 220, [], [0.5, 0.3], 1.0) * 1e6 + 1e7
    arima.append(arima_case("ma2_mean_scale1e6", x, 0, 0, 2, "mean", rescale=1e6))

    ets = []
    rng = np.random.default_rng(31)
    lvl = 20 + np.cumsum(rng.normal(0, 0.5, 120))
    ets.append(ets_case("ses", lvl + rng.normal(0, 1.0, 120), None, False, None, 0))

    rng = np.random.default_rng(32)
    t = np.arange(100)
    b = 0.4 + np.cumsum(rng.normal(0, 0.02, 100))
    ets.append(ets_case("holt", 10 + np.cumsum(b) + rng.normal(0, 1.0, 100), "add", False, None, 0))

    rng = np.random.default_rng(33)
    yb = 50 + 8 * (1 - 0.95 ** t) / 0.05 * 0.1 + np.cumsum(rng.normal(0, 0.3, 100)) + rng.normal(0, 0.8, 100)
    ets.append(ets_case("holt_damped", yb, "add", True, None, 0))

    # Seasonal cases simulated from the Holt-Winters recursions themselves with interior smoothing parameters, so the
    # optimum is well inside the box and the 1e-3 parameter pin means something.
    rng = np.random.default_rng(34)
    ets.append(ets_case("hw_add_add_q", hw_sim(rng, 80, 0.35, 0.15, 0.25, 1.0, [4.0, -1.5, -5.0, 2.5], 100.0, 0.6, 1.0,
                                               "add", "add"), "add", False, "add", 4))
    rng = np.random.default_rng(35)
    ets.append(ets_case("hw_addd_add_q", hw_sim(rng, 100, 0.4, 0.2, 0.3, 0.9, [6.0, -2.0, -7.5, 3.5], 60.0, 1.0, 1.2,
                                                "add", "add"), "add", True, "add", 4))
    rng = np.random.default_rng(36)
    mf = list(1 + 0.25 * np.sin(2 * np.pi * np.arange(12) / 12) + 0.1 * np.cos(4 * np.pi * np.arange(12) / 12))
    ets.append(ets_case("hw_add_mul_m", hw_sim(rng, 144, 0.3, 0.1, 0.2, 1.0, mf, 200.0, 1.5, 2.0, "add", "mul"),
                        "add", False, "mul", 12))
    rng = np.random.default_rng(37)
    ets.append(ets_case("hw_none_add_m", hw_sim(rng, 96, 0.3, 0.0, 0.2, 1.0, list(rng.normal(0, 3, 12)), 30.0, 0.0, 0.7,
                                                None, "add"), None, False, "add", 12))

    # The calculators' worked defaults (synthetic, rounded as a user would paste them), pinned like the other cases.
    rng = np.random.default_rng(2006)
    w = arma_sim(rng, 79, [0.5], [0.3], 0.25)
    rate = np.round(integrate(w, 1, 4.0), 2)
    labels = [f"{2006 + i // 4}-Q{i % 4 + 1}" for i in range(80)]
    arima_text = "\n".join(["Quarter Rate"] + [f"{lab} {v:.2f}" for lab, v in zip(labels, rate)])
    case = arima_case("default_arima", rate, 1, 1, 1, "none")
    case["text"] = arima_text
    arima.append(case)

    rng = np.random.default_rng(2016)
    seas = [-30.0, -22.0, 4.0, 10.0, 18.0, 30.0, 26.0, 14.0, -2.0, -6.0, -16.0, -26.0]
    sales = np.round(hw_sim(rng, 120, 0.3, 0.1, 0.2, 1.0, seas, 500.0, 2.0, 8.0, "add", "add"), 1)
    mlabels = [f"{2016 + i // 12}-{i % 12 + 1:02d}" for i in range(120)]
    ets_text = "\n".join(["Month Sales"] + [f"{lab} {v:.1f}" for lab, v in zip(mlabels, sales)])
    case = ets_case("default_ets", sales, "add", False, "add", 12)
    case["text"] = ets_text
    ets.append(case)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "statsmodels 0.15.0 (scripts/econ-ts-forecast-oracle.py)", "z975": Z975,
                   "arima": arima, "ets": ets}, f, indent=1)
    print("wrote", OUT)
    for c in arima:
        print(c["name"], "llf", c["llf"], "default", c.get("defaultLlfAtOracle"), c.get("defaultFitLlf"))
    for c in ets:
        print(c["name"], "sse", c["sse"], "alpha", c["alpha"], "beta", c["beta"], "gamma", c["gamma"], "phi", c["phi"])


if __name__ == "__main__":
    main()
