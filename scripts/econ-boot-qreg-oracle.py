"""
Oracle for the Release E4c calculators boot-ci (src/lib/bootstrap.ts) and qreg (src/lib/quantReg.ts).

BOOTSTRAP. scipy cannot share the calculator's random stream, so this script REPLAYS it: a pure-Python PCG32
(pcg_basic.c pcg32_srandom_r / pcg32_random_r / pcg32_boundedrand_r, checked here against the published first outputs
for seed 42, stream 54) draws the identical resample indices. Each replicate's statistic is computed with plain Python
float loops in the calculator's operation order, and the four intervals follow scipy 1.18
scipy/stats/_resampling.py: percentile and basic from scipy.stats.quantile(method="linear"); BCa from _bca_interval's
formulas (z0 from (count< + count<=)/(2B), acceleration from the jackknife); the normal interval
(theta_hat - bias) +/- z*SE (R boot.ci type "norm"; scipy has none). As an independent check, scipy.stats.bootstrap
itself is run on the SAME replicates (bootstrap_result=..., n_resamples=0) for the percentile, basic and BCa
intervals, with its own jackknife on numpy statistics.

QUANTILE REGRESSION. The exact LP min tau*1'u+ + (1-tau)*1'u- s.t. X b + u+ - u- = y is solved by
scipy.optimize.linprog (HiGHS, tightened tolerances). The vertex is then recovered exactly (the p rows with the
smallest |residual| form the basis, b = X_h^-1 y_h), and statsmodels 0.15 QuantReg's covariance formula
(regression/quantile_regression.py, fit(): Hall-Sheather bandwidth, Epanechnikov kernel, vcov robust and iid) is
evaluated at that vertex with numpy. Pseudo R1 = 1 - V/V0 with V0 the intercept-only LP optimum.

Data: synthetic, numpy default_rng with fixed seeds. Every number goes to the fixture as the decimal string the
calculator reads (positional, round-trip exact), and the oracle computes from float(that string).

Run: jurislab-oracle-venv python scripts/econ-boot-qreg-oracle.py
(writes src/lib/__tests__/fixtures/econ-boot-qreg-oracle.json)
"""
import json
import math
import os

import numpy as np
from scipy import stats
from scipy.optimize import linprog
from scipy.special import ndtr, ndtri

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "__tests__", "fixtures", "econ-boot-qreg-oracle.json")
M64 = (1 << 64) - 1


class Pcg32:
    def __init__(self, initstate, initseq=54):
        self.state = 0
        self.inc = ((initseq << 1) | 1) & M64
        self.next_u32()
        self.state = (self.state + initstate) & M64
        self.next_u32()

    def next_u32(self):
        old = self.state
        self.state = (old * 6364136223846793005 + self.inc) & M64
        xorshifted = (((old >> 18) ^ old) >> 27) & 0xFFFFFFFF
        rot = old >> 59
        return ((xorshifted >> rot) | (xorshifted << ((-rot) & 31))) & 0xFFFFFFFF

    def bounded(self, bound):
        threshold = ((1 << 32) - bound) % bound
        while True:
            r = self.next_u32()
            if r >= threshold:
                return r % bound


_ref = Pcg32(42)
assert [_ref.next_u32() for _ in range(6)] == [0xA15C02B7, 0x7B47F409, 0xBA1D3330, 0x83D2F293, 0xBFA4784B, 0xCBED606E]


def num_str(v):
    return np.format_float_positional(float(v), unique=True, trim="-")


# ------------------------------------------------------------------------------------------------------------------
# Bootstrap statistics in the calculator's operation order (plain float loops).

def p_mean(a):
    s = 0.0
    for v in a:
        s += v
    return s / len(a)


def p_ss(a, mu):
    s = 0.0
    for v in a:
        d = v - mu
        s += d * d
    return s


def p_stat(stat, a, b):
    m = len(a)
    if stat == "mean":
        return p_mean(a)
    if stat == "median":
        s = sorted(a)
        h = m >> 1
        return s[h] if m % 2 == 1 else (s[h - 1] + s[h]) / 2
    if stat == "trim10":
        s = sorted(a)
        cut = math.floor(0.1 * m)
        t = 0.0
        for i in range(cut, m - cut):
            t += s[i]
        return t / (m - 2 * cut)
    if stat in ("sd", "var"):
        v = p_ss(a, p_mean(a)) / (m - 1)
        return math.sqrt(v) if stat == "sd" else v
    if stat == "ratio":
        mx = p_mean(b)
        if mx == 0:
            return float("nan")
        return p_mean(a) / mx
    # corr, slope: y = a, x = b
    if all(v == b[0] for v in b) or (stat == "corr" and all(v == a[0] for v in a)):
        return float("nan")
    mx = p_mean(b)
    my = p_mean(a)
    sxx = sxy = syy = 0.0
    for i in range(m):
        dx = b[i] - mx
        dy = a[i] - my
        sxx += dx * dx
        sxy += dx * dy
        syy += dy * dy
    if sxx == 0 or (stat == "corr" and syy == 0):
        return float("nan")
    return sxy / sxx if stat == "slope" else sxy / (math.sqrt(sxx) * math.sqrt(syy))


def np_stat(stat):
    """Vectorised numpy statistics for scipy.stats.bootstrap's own jackknife."""
    if stat == "mean":
        return lambda x, axis=-1: np.mean(x, axis=axis)
    if stat == "median":
        return lambda x, axis=-1: np.median(x, axis=axis)
    if stat == "sd":
        return lambda x, axis=-1: np.std(x, ddof=1, axis=axis)
    if stat == "var":
        return lambda x, axis=-1: np.var(x, ddof=1, axis=axis)
    if stat == "trim10":
        return lambda x, axis=-1: stats.trim_mean(x, 0.1, axis=axis)
    if stat == "ratio":
        return lambda y, x, axis=-1: np.mean(y, axis=axis) / np.mean(x, axis=axis)

    def corr_slope(y, x, axis=-1):
        dx = x - np.mean(x, axis=axis, keepdims=True)
        dy = y - np.mean(y, axis=axis, keepdims=True)
        sxy = np.sum(dx * dy, axis=axis)
        sxx = np.sum(dx * dx, axis=axis)
        if stat == "slope":
            return sxy / sxx
        return sxy / (np.sqrt(sxx) * np.sqrt(np.sum(dy * dy, axis=axis)))

    return corr_slope


def q7(sorted_vals, p):
    """Hyndman-Fan type 7 in scipy _quantile_hf's operation order."""
    n = len(sorted_vals)
    jg = p * n + (1 - p)
    jp1 = math.floor(jg)
    j = jp1 - 1
    g = jg % 1
    if j < 0:
        g = 0.0
    j = min(max(j, 0), n - 1)
    k = min(max(jp1, 0), n - 1)
    return (1 - g) * sorted_vals[j] + g * sorted_vals[k]


def boot_case(name, stat, y, x, B, conf, seed):
    y = [float(num_str(v)) for v in y]
    x = None if x is None else [float(num_str(v)) for v in x]
    n = len(y)
    theta = p_stat(stat, list(y), None if x is None else list(x))
    rng = Pcg32(seed)
    reps = []
    dropped = 0
    for _ in range(B):
        if x is not None:
            idx = [rng.bounded(n) for _ in range(n)]
            a = [y[k] for k in idx]
            b = [x[k] for k in idx]
        else:
            a = [y[rng.bounded(n)] for _ in range(n)]
            b = None
        t = p_stat(stat, a, b)
        if math.isfinite(t):
            reps.append(t)
        else:
            dropped += 1
    Bv = len(reps)
    srt = sorted(reps)
    s = 0.0
    for v in reps:
        s += v
    mstar = s / Bv
    ss = 0.0
    for v in reps:
        ss += (v - mstar) * (v - mstar)
    se = math.sqrt(ss / (Bv - 1))
    bias = mstar - theta
    alpha = (1 - conf) / 2
    pct = [q7(srt, alpha), q7(srt, 1 - alpha)]
    basic = [2 * theta - pct[1], 2 * theta - pct[0]]
    z = -float(ndtri(alpha))
    normal = [theta - bias - z * se, theta - bias + z * se]
    # Jackknife (direct, as the calculator does for n <= 4000).
    jack = []
    for i in range(n):
        a = y[:i] + y[i + 1:]
        b = None if x is None else x[:i] + x[i + 1:]
        jack.append(p_stat(stat, a, b))
    below = sum(1 for v in reps if v < theta)
    ator = sum(1 for v in reps if v <= theta)
    p0 = (below + ator) / (2 * Bv)
    sj = 0.0
    for v in jack:
        sj += v
    jbar = sj / n
    num = den = 0.0
    for v in jack:
        u = (n - 1) * (jbar - v)
        num += u * u * u
        den += u * u
    a_hat = 1 / 6 * (num / n ** 3) / (den / n ** 2) ** (3 / 2)
    z0 = float(ndtri(p0))
    za = float(ndtri(alpha))
    n1 = z0 + za
    a1 = float(ndtr(z0 + n1 / (1 - a_hat * n1)))
    n2 = z0 - za
    a2 = float(ndtr(z0 + n2 / (1 - a_hat * n2)))
    bca = [q7(srt, a1), q7(srt, a2)]

    # scipy.stats.bootstrap on the SAME replicates.
    prior = stats._resampling.BootstrapResult(confidence_interval=None, bootstrap_distribution=np.array(reps), standard_error=None)
    data = (np.array(y),) if x is None else (np.array(y), np.array(x))
    scipy_res = {}
    for meth in ("percentile", "basic", "BCa"):
        r = stats.bootstrap(data, np_stat(stat), n_resamples=0, bootstrap_result=prior, confidence_level=conf, method=meth,
                            paired=x is not None, vectorized=True)
        scipy_res[meth] = [float(r.confidence_interval.low), float(r.confidence_interval.high)]
    scipy_se = float(r.standard_error)
    # scipy's own theta_hat (numpy's pairwise sums) can differ from the sequential one in the last bits; when some
    # replicates EQUAL theta_hat exactly (a resample that permutes the data), that flips them across it in z0's count.
    scipy_theta = float(np_stat(stat)(*data))
    ties_at_theta = sum(1 for v in reps if v == theta)

    header = "y" if x is None else "y\tx"
    rows = [num_str(v) if x is None else f"{num_str(v)}\t{num_str(w)}" for v, w in zip(y, x if x is not None else y)]
    return {
        "name": name, "stat": stat, "B": B, "conf": conf, "seed": seed,
        "data": "\n".join([header] + rows),
        "y": [num_str(v) for v in y], "x": None if x is None else [num_str(v) for v in x],
        "theta": theta, "se": se, "bias": bias, "dropped": dropped, "nUsed": Bv,
        "first5": reps[:5], "last": reps[-1],
        "percentile": pct, "basic": basic, "normal": normal, "bca": bca,
        "z0": z0, "a": a_hat, "alpha1": a1, "alpha2": a2,
        "scipy": scipy_res, "scipySe": scipy_se, "scipyTheta": scipy_theta, "tiesAtTheta": ties_at_theta,
    }


def boot_cases():
    out = []
    g = np.random.default_rng(20261025)
    out.append(boot_case("mean lognormal n=25", "mean", np.round(np.exp(g.normal(3, 0.8, 25)), 3), None, 2000, 0.95, 12345))
    med = np.round(g.normal(50, 10, 40)).astype(float)  # integer values: ties
    out.append(boot_case("median n=40 with ties", "median", med, None, 999, 0.90, 7))
    out.append(boot_case("sd skewed n=30", "sd", np.round(g.gamma(2.0, 3.0, 30), 4), None, 1500, 0.95, 2024))
    out.append(boot_case("variance n=18", "var", np.round(g.normal(0, 2, 18), 5), None, 2000, 0.99, 99))
    out.append(boot_case("trimmed mean n=37", "trim10", np.round(g.standard_t(3, 37) * 5 + 20, 4), None, 2000, 0.95, 31337))
    xc = g.normal(0, 1, 60)
    yc = 0.6 * xc + g.normal(0, 0.8, 60)
    out.append(boot_case("correlation n=60", "corr", np.round(yc, 5), np.round(xc, 5), 2000, 0.95, 12345))
    xr = np.round(g.uniform(50, 150, 35), 2)
    yr = np.round(xr * 0.7 + g.normal(0, 8, 35), 2)
    out.append(boot_case("ratio of means n=35", "ratio", yr, xr, 1200, 0.95, 5))
    # Awkward: a slope on a nearly binary x with n = 9 (some resamples have a constant x -> dropped and counted).
    xs = np.array([0, 0, 0, 0, 0, 0, 1, 1, 1], dtype=float)
    ys = np.round(1.0 + 2.0 * xs + g.normal(0, 0.5, 9), 3)
    out.append(boot_case("slope n=9 near-binary x (dropped resamples)", "slope", ys, xs, 2000, 0.95, 12345))
    xl = np.round(g.normal(10, 3, 80), 4)
    yl = np.round(2 + 0.5 * xl + g.normal(0, 1, 80) * (0.2 * xl), 4)
    out.append(boot_case("slope n=80 heteroskedastic", "slope", yl, xl, 2000, 0.95, 4242))
    # Scale: values near 1e12 (mean) and 1e-12 (sd).
    out.append(boot_case("mean at 1e12", "mean", np.round(1e12 + g.normal(0, 1e6, 20)), None, 1000, 0.95, 1))
    out.append(boot_case("sd at 1e-12", "sd", [float(f"{v:.6e}") for v in g.normal(5e-12, 1e-12, 20)], None, 1000, 0.95, 2))
    return out


# ------------------------------------------------------------------------------------------------------------------
# Quantile regression.

def lp_solve(X, y, tau):
    n, p = X.shape
    c = np.concatenate([np.zeros(p), tau * np.ones(n), (1 - tau) * np.ones(n)])
    A = np.hstack([X, np.eye(n), -np.eye(n)])
    bounds = [(None, None)] * p + [(0, None)] * (2 * n)
    res = linprog(c, A_eq=A, b_eq=y, bounds=bounds, method="highs",
                  options={"primal_feasibility_tolerance": 1e-10, "dual_feasibility_tolerance": 1e-10})
    assert res.status == 0, res.message
    return res.x[:p], res.fun


def rho(r, tau):
    return float(np.sum(np.where(r < 0, (tau - 1) * r, tau * r)))


def hall_sheather(n, q, alpha=0.05):
    z = stats.norm.ppf(q)
    num = 1.5 * stats.norm.pdf(z) ** 2.0
    den = 2.0 * z ** 2.0 + 1.0
    return n ** (-1.0 / 3) * stats.norm.ppf(1.0 - alpha / 2.0) ** (2.0 / 3) * (num / den) ** (1.0 / 3)


def sm_cov(X, y, e, q, vcov):
    """statsmodels QuantReg.fit's covariance block, verbatim in numpy, at residuals e."""
    nobs = len(y)
    iqre = stats.scoreatpercentile(e, 75) - stats.scoreatpercentile(e, 25)
    h = hall_sheather(nobs, q)
    h = min(np.std(y), iqre / 1.34) * (stats.norm.ppf(q + h) - stats.norm.ppf(q - h))
    kern = lambda u: 3.0 / 4 * (1 - u ** 2) * np.where(np.abs(u) <= 1, 1, 0)
    fhat0 = 1.0 / (nobs * h) * np.sum(kern(e / h))
    # statsmodels forms pinv(X'X) from the UNSCALED design. With columns ~1e6 and ~1e-6 apart, X'X has condition
    # number ~1e24 and pinv's 1e-15 cutoff truncates it (the SE of the 1e-6 column came out 2e-11 of its true value).
    # The formula is equivariant under column scaling, so it is evaluated on X/s and unscaled: V = S^-1 Vs S^-1.
    s = np.abs(X).max(axis=0)
    Xs = X / s
    if vcov == "robust":
        d = np.where(e > 0, (q / fhat0) ** 2, ((1 - q) / fhat0) ** 2)
        xtxi = np.linalg.pinv(np.dot(Xs.T, Xs))
        xtdx = np.dot(Xs.T * d[np.newaxis, :], Xs)
        Vs = xtxi @ xtdx @ xtxi
    else:
        Vs = (1.0 / fhat0) ** 2 * q * (1 - q) * np.linalg.pinv(np.dot(Xs.T, Xs))
    V = Vs / np.outer(s, s)
    return V, h, 1.0 / fhat0


def qreg_case(name, cols, names, y, taus, vcov, constant, degenerate):
    cols = [[float(num_str(v)) for v in c] for c in cols]
    y = np.array([float(num_str(v)) for v in y])
    n = len(y)
    Xl = [np.array(c) for c in cols] + ([np.ones(n)] if constant else [])
    X = np.column_stack(Xl)
    p = X.shape[1]
    fits = []
    for tau in taus:
        b_lp, obj = lp_solve(X, y, tau)
        r = y - X @ b_lp
        if degenerate:
            # The minimiser need not be unique: only the objective is pinned, so no vertex is recovered.
            b = b_lp
            e = r
        else:
            basis = np.argsort(np.abs(r), kind="stable")[:p]
            b = np.linalg.solve(X[basis], y[basis])
            e = y - X @ b
            e[basis] = 0.0
        V, h, spars = sm_cov(X, y, e, tau, vcov)
        se = np.sqrt(np.diag(V))
        df = n - p
        t = b / se
        pv = 2 * stats.t.sf(np.abs(t), df)
        tc = stats.t.ppf(0.975, df)
        b0, v0 = lp_solve(np.ones((n, 1)), y, tau)
        fits.append({
            "tau": tau, "objectiveLp": obj, "objectiveVertex": rho(e, tau), "betaLp": b_lp.tolist(), "beta": b.tolist(),
            "se": se.tolist(), "t": t.tolist(), "p": pv.tolist(), "ciLo": (b - tc * se).tolist(), "ciHi": (b + tc * se).tolist(),
            "bandwidth": h, "sparsity": spars, "r1": 1 - obj / v0, "v0": v0,
        })
    header = "\t".join(["y"] + names)
    rows = ["\t".join([num_str(y[i])] + [num_str(c[i]) for c in cols]) for i in range(n)]
    return {
        "name": name, "data": "\n".join([header] + rows), "spec": "y ~ " + " + ".join(names),
        "quantiles": ", ".join(str(t) for t in taus), "se": vcov, "constant": "yes" if constant else "no",
        "degenerate": degenerate, "n": n, "fits": fits,
    }


def qreg_cases():
    out = []
    g = np.random.default_rng(19781025)
    n = 201
    x1 = g.normal(0, 1, n)
    x2 = g.uniform(0, 10, n)
    y = 1 + 2 * x1 - 0.3 * x2 + g.normal(0, 1, n) * (1 + 0.3 * x2)
    out.append(qreg_case("continuous n=201 robust", [x1, x2], ["x1", "x2"], y, [0.25, 0.5, 0.75], "robust", True, False))
    out.append(qreg_case("continuous n=201 iid", [x1, x2], ["x1", "x2"], y, [0.1, 0.9], "iid", True, False))
    n = 1003
    X3 = g.normal(0, 1, (n, 3))
    y3 = 0.5 + X3 @ np.array([1.0, -0.5, 0.25]) + g.standard_t(3, n)
    out.append(qreg_case("heavy tails n=1003, 3 regressors", [X3[:, 0], X3[:, 1], X3[:, 2]], ["a", "b", "c"], y3, [0.05, 0.5, 0.95], "robust", True, False))
    # Awkward: scales 1e6 and 1e-6, unbalanced design (a rare dummy), no ties.
    n = 157
    big = g.normal(5e6, 1e6, n)
    tiny = g.normal(0, 3e-6, n)
    dummy = (g.uniform(0, 1, n) < 0.12).astype(float)
    yy = 3 + 2e-6 * big + 4e5 * tiny + 1.5 * dummy + g.normal(0, 1, n)
    out.append(qreg_case("scales 1e6 / 1e-6 with a rare dummy", [big, tiny, dummy], ["big", "tiny", "dummy"], yy, [0.3, 0.7], "robust", True, False))
    # No constant.
    n = 120
    xn = g.uniform(1, 5, n)
    yn = 2 * xn + g.normal(0, 1, n) * xn
    out.append(qreg_case("no constant n=120", [xn], ["x"], yn, [0.4, 0.6], "robust", False, False))
    # Degenerate: integer y and integer x, n*tau whole (objective pin only).
    n = 120
    xi = g.integers(0, 6, n).astype(float)
    yi = np.round(2 + xi + g.normal(0, 2, n))
    out.append(qreg_case("integer y, n*tau whole (degenerate)", [xi], ["x"], yi, [0.25, 0.5], "robust", True, True))
    return out


def main():
    fx = {"boot": boot_cases(), "qreg": qreg_cases()}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fx, f, indent=1)
    print("wrote", OUT, len(fx["boot"]), "bootstrap cases,", len(fx["qreg"]), "quantile cases")


if __name__ == "__main__":
    main()
