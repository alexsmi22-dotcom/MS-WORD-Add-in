"""
Oracle for Release F2 item #11, limited dependent and count models (src/lib/limdep.ts, src/lib/limdepStatCalcs.ts).

Run:  ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/limdep-oracle.py
Writes src/lib/__tests__/fixtures/limdep-oracle.json (statsmodels 0.15, scipy 1.18, numpy).

Every dataset is synthetic (seeded numpy), ROUNDED to the printed decimals, written into the fixture as the exact text
the calculators read, and the oracle fits the ROUNDED values parsed back from that text.

Sources, by model:
  Poisson            statsmodels Poisson(offset = ln exposure), method="newton"; classical (inverse Hessian) and
                     cov_type="HC0". llnull as statsmodels reports it (constant + offset).
  Overdispersion     Cameron & Trivedi (1990) auxiliary regression, by hand: OLS without a constant of
                     ((y − μ̂)² − y)/μ̂ on μ̂ (the NB2 alternative); t on the slope, one-sided p from t(n − 1).
  NB2                statsmodels NegativeBinomial(loglike_method="nb2", offset = ln exposure), newton from the bfgs
                     solution; classical and HC0; llnull (constant-only NB2) as statsmodels reports it; LR test of
                     α = 0 against Poisson with the boundary p = ½ P(χ²₁ > LR).
  Tobit              statsmodels has no tobit: an independent scipy MLE in (β, ln σ) with scipy.stats.norm.logcdf /
                     logpdf, BFGS to gtol 1e-11 then Newton polish with the statsmodels numerical Hessian
                     (approx_hess3) of the log likelihood in (β, σ); covariance = inverse of that Hessian. Marginal
                     effects by the closed forms (averaged over the sample) with delta-method SEs from a central
                     numerical Jacobian; the closed forms are cross-checked against numerical derivatives of the
                     expectations themselves.
  Heckman two-step   by hand in numpy following Wooldridge, Econometric Analysis of Cross Section and Panel Data
                     (2nd ed., 2010), §19.6 (probit of s on z, inverse Mills ratio λ = φ(zγ)/Φ(zγ), OLS of y on x and
                     λ on the selected sample); the corrected covariance is the Heckman (1979) form
                     σ²(X*'X*)⁻¹[X*'(I − ρ²Δ)X* + ρ²(X*'ΔZ)V_γ(Z'ΔX*)](X*'X*)⁻¹ with δ = λ(λ + zγ),
                     σ² = e'e/n₁ + b_λ² mean(δ), ρ = b_λ/σ (|ρ| > 1 truncated to ±1 with σ = |b_λ|).
                     Stage 1 by statsmodels Probit (newton), V_γ its inverse observed information.
  Ordered            statsmodels OrderedModel (distr "logit" / "probit"), bfgs to gtol 1e-11; its threshold
                     parameters (first cut, then log increments) mapped to cut points with the Jacobian applied to
                     cov_params.
  Multinomial logit  statsmodels MNLogit, newton; base category recoded to sort first; get_margeff(at="overall",
                     method="dydx").
"""
import json
import math
import os

import numpy as np
import statsmodels.api as sm
from scipy import optimize, stats
from statsmodels.discrete.discrete_model import MNLogit, NegativeBinomial, Poisson, Probit
from statsmodels.miscmodels.ordinal_model import OrderedModel
from statsmodels.tools.numdiff import approx_fprime, approx_hess3

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "__tests__", "fixtures", "limdep-oracle.json")


def fmt(v, d):
    s = f"{v:.{d}f}"
    if s.startswith("-") and float(s) == 0:
        s = s[1:]
    return s


def table_text(names, cols, decs):
    lines = [" ".join(names)]
    n = len(cols[0])
    for i in range(n):
        cells = []
        for c, d in zip(cols, decs):
            v = c[i]
            cells.append("NA" if v is None else fmt(v, d))
        lines.append(" ".join(cells))
    return "\n".join(lines)


def parse(text):
    lines = text.split("\n")
    names = lines[0].split()
    rows = [l.split() for l in lines[1:]]
    out = {}
    for j, nm in enumerate(names):
        out[nm] = [None if r[j] == "NA" else float(r[j]) for r in rows]
    return out


def L(a):
    return [float(x) for x in np.asarray(a).ravel()]


# ------------------------------------------------------------------------------------------------- count data
def make_count(seed, n, alpha, shift=0.0):
    rng = np.random.default_rng(seed)
    age = np.round(rng.uniform(20, 70, n))
    income = np.round(rng.lognormal(3.6, 0.5, n), 1)
    female = (rng.uniform(size=n) < 0.5).astype(float)
    years = np.round(rng.uniform(0.5, 3.0, n), 2)
    eta = -0.8 + shift + 0.015 * age - 0.006 * income + 0.35 * female + np.log(years)
    mu = np.exp(eta)
    lam = mu * rng.gamma(1 / alpha, alpha, n) if alpha > 0 else mu
    y = rng.poisson(lam).astype(float)
    return table_text(["visits", "age", "income", "female", "years"], [y, age, income, female, years], [0, 0, 1, 0, 2])


def count_oracle(text, preds, exposure, constant=True):
    d = parse(text)
    y = np.array(d["visits"])
    X = np.column_stack([d[p] for p in preds])
    if constant:
        X = np.column_stack([X, np.ones(len(y))])  # constant LAST, as the tables print it
    off = np.log(np.array(d[exposure])) if exposure else None
    pm = Poisson(y, X, offset=off)
    pr = pm.fit(method="newton", tol=1e-14, maxiter=200, disp=0)
    prh = pm.fit(method="newton", tol=1e-14, maxiter=200, disp=0, cov_type="HC0")
    mu = pr.predict(offset=off) if off is not None else pr.predict()
    mu = np.exp(X @ pr.params + (off if off is not None else 0))
    z = ((y - mu) ** 2 - y) / mu
    a_ct = float(np.sum(z * mu) / np.sum(mu * mu))
    e = z - a_ct * mu
    s2 = float(np.sum(e * e) / (len(y) - 1))
    se_ct = math.sqrt(s2 / float(np.sum(mu * mu)))
    t_ct = a_ct / se_ct
    p_ct = float(stats.t.sf(t_ct, len(y) - 1))
    pearson = float(np.sum((y - mu) ** 2 / mu))
    out = {
        "poisson": {
            "params": L(pr.params), "bse": L(pr.bse), "bseHC0": L(prh.bse), "llf": float(pr.llf), "llnull": float(pr.llnull),
            "pearson": pearson, "dfResid": float(pr.df_resid),
            "deviance": float(2 * np.sum(np.where(y > 0, y * np.log(np.where(y > 0, y, 1) / mu), 0) - (y - mu))),
            "ct": {"alpha": a_ct, "se": se_ct, "t": t_ct, "p": p_ct},
            "scoreMax": float(np.max(np.abs(pm.score(pr.params)))),
        }
    }
    score0 = float(np.sum((y - mu) ** 2 - y)) / 2
    out["poisson"]["alphaScoreAt0"] = score0
    K = int(np.max(y))
    if K <= 40:  # mean fitted probability of each count 0..K (scipy.stats pmfs)
        out["poisson"]["freqPred"] = [float(np.mean(stats.poisson.pmf(c, mu))) for c in range(K + 1)]
    if score0 > 0:
        nm = NegativeBinomial(y, X, loglike_method="nb2", offset=off)
        start = np.append(pr.params, 0.5)
        r0 = nm.fit(start_params=start, method="bfgs", maxiter=2000, gtol=1e-10, disp=0)
        nr = nm.fit(start_params=r0.params, method="newton", tol=1e-14, maxiter=200, disp=0)
        nrh = nm.fit(start_params=r0.params, method="newton", tol=1e-14, maxiter=200, disp=0, cov_type="HC0")
        lr = 2 * (nr.llf - pr.llf)
        out["nb2"] = {
            "params": L(nr.params), "bse": L(nr.bse), "bseHC0": L(nrh.bse), "llf": float(nr.llf), "llnull": float(nr.llnull),
            "lrAlpha": float(lr), "pAlpha": float(0.5 * stats.chi2.sf(lr, 1)) if lr > 0 else 0.5,
            "scoreMax": float(np.max(np.abs(nm.score(nr.params)))),
        }
        if K <= 40:
            r_ = 1 / nr.params[-1]
            mu_nb = np.exp(X @ nr.params[:-1] + (off if off is not None else 0))
            out["nb2"]["freqPred"] = [float(np.mean(stats.nbinom.pmf(c, r_, r_ / (r_ + mu_nb)))) for c in range(K + 1)]
    return out


# ------------------------------------------------------------------------------------------------- tobit
def make_tobit(seed, n, upper_only=False):
    rng = np.random.default_rng(seed)
    educ = rng.integers(8, 19, n).astype(float)
    age = rng.integers(25, 61, n).astype(float)
    kids = rng.integers(0, 4, n).astype(float)
    ystar = -8 + 1.2 * educ + 0.05 * age - 2.5 * kids + 6 * rng.standard_normal(n)
    if upper_only:
        y = np.minimum(ystar, 15.0)
    else:
        y = np.maximum(ystar, 0.0)
    return table_text(["hours", "educ", "age", "kids"], [y, educ, age, kids], [2, 0, 0, 0])


def tobit_ll(par, y, X, lo, hi):
    k = X.shape[1]
    b = par[:k]
    s = par[k]
    if s <= 0:
        return -np.inf
    xb = X @ b
    ll = np.where(
        (lo is not None) & (y <= (lo if lo is not None else -np.inf)),
        stats.norm.logcdf(((lo if lo is not None else 0) - xb) / s),
        np.where(
            (hi is not None) & (y >= (hi if hi is not None else np.inf)),
            stats.norm.logsf(((hi if hi is not None else 0) - xb) / s),
            stats.norm.logpdf((y - xb) / s) - np.log(s),
        ),
    )
    return float(np.sum(ll))


def tobit_fit(y, X, lo, hi):
    k = X.shape[1]
    b0 = np.linalg.lstsq(X, y, rcond=None)[0]
    s0 = float(np.std(y - X @ b0))
    f = lambda q: -tobit_ll(np.append(q[:k], math.exp(q[k])), y, X, lo, hi)
    r = optimize.minimize(f, np.append(b0, math.log(s0)), method="BFGS", options={"gtol": 1e-11, "maxiter": 20000})
    par = np.append(r.x[:k], math.exp(r.x[k]))
    llf = lambda q: tobit_ll(q, y, X, lo, hi)
    for _ in range(30):  # Newton polish in (β, σ) with numerical derivatives
        g = approx_fprime(par, llf, centered=True)
        H = approx_hess3(par, llf)
        step = np.linalg.solve(H, g)
        par = par - step
        if np.max(np.abs(step)) < 1e-12 * (1 + np.max(np.abs(par))):
            break
    H = approx_hess3(par, llf)
    cov = np.linalg.inv(-H)
    return par, cov, llf(par), float(np.max(np.abs(approx_fprime(par, llf, centered=True))))


def tobit_ame(par, X, lo, hi, j):
    k = X.shape[1]
    b = par[:k]
    s = par[k]
    xb = X @ b
    zl = (lo - xb) / s if lo is not None else np.full(len(xb), -np.inf)
    zu = (hi - xb) / s if hi is not None else np.full(len(xb), np.inf)
    Pl, Pu = stats.norm.cdf(zl), stats.norm.cdf(zu)
    fl = stats.norm.pdf(zl)
    fu = stats.norm.pdf(zu)
    zfl = np.where(np.isfinite(zl), zl * fl, 0)
    zfu = np.where(np.isfinite(zu), zu * fu, 0)
    P = Pu - Pl
    D = fl - fu
    e_unc = b[j] * np.mean(P)
    e_cond = b[j] * np.mean(1 + (zfl - zfu) / P - (D / P) ** 2)
    p_unc = b[j] / s * np.mean(fl - fu)
    return np.array([e_unc, e_cond, p_unc])


def tobit_expectations(par, X, lo, hi):
    """E[y], E[y | uncensored], P(uncensored) per row (for the numerical cross-check of the closed forms)."""
    k = X.shape[1]
    b = par[:k]
    s = par[k]
    xb = X @ b
    zl = (lo - xb) / s if lo is not None else np.full(len(xb), -np.inf)
    zu = (hi - xb) / s if hi is not None else np.full(len(xb), np.inf)
    Pl, Pu = stats.norm.cdf(zl), stats.norm.cdf(zu)
    fl, fu = stats.norm.pdf(zl), stats.norm.pdf(zu)
    P = Pu - Pl
    econd = xb + s * (fl - fu) / P
    ey = (lo * Pl if lo is not None else 0) + (hi * (1 - Pu) if hi is not None else 0) + P * econd
    return ey, econd, P


def tobit_oracle(text, preds, lo, hi):
    d = parse(text)
    y = np.array(d["hours"])
    X = np.column_stack([np.column_stack([d[p] for p in preds]), np.ones(len(y))])
    par, cov, llf, smax = tobit_fit(y, X, lo, hi)
    par0, cov0, ll0, _ = tobit_fit(y, np.ones((len(y), 1)), lo, hi)
    ames = []
    for j in range(len(preds)):
        a = tobit_ame(par, X, lo, hi, j)
        J = approx_fprime(par, lambda q: tobit_ame(q, X, lo, hi, j), centered=True)
        se = np.sqrt(np.diag(J @ cov @ J.T))
        # cross-check: numerical derivative of the averaged expectations in x_j
        h = 1e-5
        Xp, Xm = X.copy(), X.copy()
        Xp[:, j] += h
        Xm[:, j] -= h
        ep, cp, pp = tobit_expectations(par, Xp, lo, hi)
        em, cm, pm = tobit_expectations(par, Xm, lo, hi)
        num = np.array([np.mean(ep - em), np.mean(cp - cm), np.mean(pp - pm)]) / (2 * h)
        assert np.max(np.abs(num - a)) < 1e-6 * (1 + np.max(np.abs(a))), (num, a)
        ames.append({"est": L(a), "se": L(se)})
    nl = int(np.sum(y <= lo)) if lo is not None else 0
    nu = int(np.sum(y >= hi)) if hi is not None else 0
    return {
        "beta": L(par[:-1]), "sigma": float(par[-1]), "bse": L(np.sqrt(np.diag(cov))[:-1]), "seSigma": float(math.sqrt(cov[-1, -1])),
        "llf": llf, "llnull": ll0, "ame": ames, "nLeft": nl, "nRight": nu, "scoreMax": smax,
    }


# ------------------------------------------------------------------------------------------------- heckman
def make_heckman(seed, n):
    rng = np.random.default_rng(seed)
    educ = rng.integers(8, 19, n).astype(float)
    exper = rng.integers(0, 31, n).astype(float)
    kids = rng.integers(0, 4, n).astype(float)
    married = (rng.uniform(size=n) < 0.55).astype(float)
    cov = [[1.0, 0.5 * 0.4], [0.5 * 0.4, 0.16]]
    ev = rng.multivariate_normal([0, 0], cov, n)
    sstar = -0.5 + 0.08 * educ + 0.03 * exper - 0.5 * kids - 0.3 * married + ev[:, 0]
    works = (sstar > 0).astype(float)
    lw = 0.5 + 0.08 * educ + 0.02 * exper + ev[:, 1]
    lwage = [float(v) if w == 1 else None for v, w in zip(lw, works)]
    return table_text(["works", "lwage", "educ", "exper", "kids", "married"], [works, lwage, educ, exper, kids, married], [0, 3, 0, 0, 0, 0])


def heckman_oracle(text, xnames, znames):
    d = parse(text)
    s = np.array(d["works"])
    Z = np.column_stack([np.column_stack([d[p] for p in znames]), np.ones(len(s))])
    pr = Probit(s, Z).fit(method="newton", tol=1e-14, maxiter=200, disp=0)
    g = pr.params
    Vg = pr.cov_params()
    sel = s == 1
    zg = Z[sel] @ g
    lam = stats.norm.pdf(zg) / stats.norm.cdf(zg)
    delta = lam * (lam + zg)
    y = np.array([v for v, w in zip(d["lwage"], s) if w == 1])
    X = np.column_stack([np.column_stack([np.array(d[p])[sel] for p in xnames]), lam, np.ones(int(sel.sum()))])
    b = np.linalg.solve(X.T @ X, X.T @ y)
    e = y - X @ b
    n1 = int(sel.sum())
    bl = b[len(xnames)]
    sig2 = float(e @ e / n1 + bl * bl * np.mean(delta))
    sig = math.sqrt(sig2)
    rho = bl / sig
    truncated = False
    if abs(rho) > 1:
        truncated = True
        rho = math.copysign(1.0, rho)
        sig = abs(bl)
        sig2 = sig * sig
    Zs = Z[sel]
    D = np.diag(delta)
    XtXi = np.linalg.inv(X.T @ X)
    Q = rho * rho * (X.T @ D @ Zs) @ Vg @ (Zs.T @ D @ X)
    V = sig2 * XtXi @ (X.T @ (np.eye(n1) - rho * rho * D) @ X + Q) @ XtXi
    kx = len(xnames)
    bx = b[:kx]
    wald = float(bx @ np.linalg.solve(V[:kx, :kx], bx))
    return {
        "gamma": L(g), "gammaSe": L(pr.bse), "probitLl": float(pr.llf), "beta": L(b), "bse": L(np.sqrt(np.diag(V))),
        "rho": float(rho), "sigma": float(sig), "truncated": truncated, "nSel": n1, "n": int(len(s)), "wald": wald,
    }


# ------------------------------------------------------------------------------------------------- ordered
def make_ordered(seed, n, J=4):
    rng = np.random.default_rng(seed)
    price = np.round(rng.uniform(1, 10, n), 2)
    quality = rng.integers(1, 6, n).astype(float)
    online = (rng.uniform(size=n) < 0.4).astype(float)
    ystar = -0.3 * price + 0.8 * quality + 0.5 * online + rng.logistic(size=n)
    qs = np.quantile(ystar, np.linspace(0, 1, J + 1)[1:-1])
    rating = 1 + np.searchsorted(qs, ystar).astype(float)
    return table_text(["rating", "price", "quality", "online"], [rating, price, quality, online], [0, 2, 0, 0])


def ordered_oracle(text, preds, distr):
    d = parse(text)
    y = np.array(d["rating"])
    X = np.column_stack([d[p] for p in preds])
    m = OrderedModel(y, X, distr=distr)
    r = m.fit(method="bfgs", maxiter=20000, gtol=1e-11, disp=0)
    r = m.fit(start_params=r.params, method="newton", maxiter=100, tol=1e-14, disp=0)
    k = len(preds)
    th = r.params[k:]
    cuts = np.cumsum(np.concatenate([[th[0]], np.exp(th[1:])]))
    J = len(th)
    Jac = np.zeros((J, J))
    for a in range(J):
        Jac[a, 0] = 1
        for b in range(1, a + 1):
            Jac[a, b] = math.exp(th[b])
    C = r.cov_params()
    Cth = C[k:, k:]
    cut_cov = Jac @ Cth @ Jac.T
    cats, counts = np.unique(y, return_counts=True)
    ll0 = float(np.sum(counts * np.log(counts / len(y))))
    probs = r.predict()
    return {
        "beta": L(r.params[:k]), "bse": L(r.bse[:k]), "cuts": L(cuts), "cutSe": L(np.sqrt(np.diag(cut_cov))),
        "llf": float(r.llf), "llnull": ll0, "meanProb": L(np.mean(probs, axis=0)),
        "scoreMax": float(np.max(np.abs(m.score(r.params)))),
    }


# ------------------------------------------------------------------------------------------------- multinomial
def make_mnl(seed, n):
    rng = np.random.default_rng(seed)
    income = np.round(rng.uniform(10, 100, n), 1)
    age = rng.integers(18, 71, n).astype(float)
    u1 = rng.gumbel(size=n)
    u2 = -1 + 0.03 * income - 0.01 * age + rng.gumbel(size=n)
    u3 = 1 - 0.01 * income - 0.03 * age + rng.gumbel(size=n) + 0.8
    choice = 1 + np.argmax(np.column_stack([u1, u2, u3]), axis=1).astype(float)
    return table_text(["mode", "income", "age"], [choice, income, age], [0, 1, 0])


def mnl_oracle(text, preds, base):
    d = parse(text)
    y = np.array(d["mode"])
    cats = sorted(set(y))
    order = [base] + [c for c in cats if c != base]
    code = np.array([order.index(v) for v in y], dtype=float)
    X = np.column_stack([np.column_stack([d[p] for p in preds]), np.ones(len(y))])
    m = MNLogit(code, X)
    r = m.fit(method="newton", tol=1e-14, maxiter=200, disp=0)
    me = r.get_margeff(at="overall", method="dydx")
    # params: (k+1) x (J-1), columns = order[1:]
    return {
        "order": order, "params": [L(r.params[:, j]) for j in range(len(cats) - 1)], "bse": [L(r.bse[:, j]) for j in range(len(cats) - 1)],
        "llf": float(r.llf), "llnull": float(r.llnull),
        # margeff: k x J (constant excluded), columns in `order`
        "ame": [L(me.margeff[:, j]) for j in range(len(cats))], "ameSe": [L(me.margeff_se[:, j]) for j in range(len(cats))],
        "scoreMax": float(np.max(np.abs(m.score(r.params.ravel(order="F"))))),
    }


def binary_probit_logit(text, preds, cut_at):
    """The J = 2 ordered model against binary Probit/Logit (adversarial)."""
    d = parse(text)
    y = (np.array(d["rating"]) > cut_at).astype(float)
    X = np.column_stack([np.column_stack([d[p] for p in preds]), np.ones(len(y))])
    out = {}
    for nm, M in (("probit", Probit), ("logit", sm.Logit)):
        r = M(y, X).fit(method="newton", tol=1e-14, maxiter=200, disp=0)
        out[nm] = {"params": L(r.params), "bse": L(r.bse), "llf": float(r.llf)}
    return out


DEFAULTS = os.path.join(ROOT, "src", "lib", "limdepDefaults.ts")


def write_defaults(fx):
    """The calculators' worked defaults, generated from the SAME rounded text the oracle fitted (no transcription)."""
    out = [
        "/**",
        " * Worked defaults of the F2 #11 limited-dependent calculators (src/lib/limdepStatCalcs.ts): synthetic data, GENERATED",
        " * by scripts/limdep-oracle.py from the rounded text the oracle fitted (do not edit by hand; rerun the script).",
        " * Seeds: count 20261027 (NB2, α = 0.6, exposure in years), tobit 1987 (censored at 0), Heckman 1979 (ρ = 0.5),",
        " * ordered 2026 (four ratings), multinomial 1993 (three modes).",
        " */",
        "",
    ]
    for key, name, what in [
        ("count", "COUNT", "200 people: doctor visits, age, income (thousands), female, years observed (the exposure)."),
        ("tobit", "TOBIT", "200 people: weekly hours of a side job (censored at 0), education, age, children."),
        ("heckman", "HECKMAN", "300 people: works (0/1), log wage (NA when not working), education, experience, children, married."),
        ("ordered", "ORDERED", "250 products: rating 1 to 4, price, quality score, sold online."),
        ("mnl", "MNL", "300 commuters: mode 1, 2 or 3, income (thousands), age."),
    ]:
        lines = fx[key]["data"].split("\n")
        out.append(f"/** {what} */")
        out.append(f"export const LIMDEP_{name}_DEFAULT = [")
        out.append(f'  "{lines[0]}",')
        rows = lines[1:]
        for i in range(0, len(rows), 8):
            out.append("  " + ", ".join(f'"{r}"' for r in rows[i:i + 8]) + ",")
        out.append('].join("' + chr(92) + 'n");')
        out.append("")
    with open(DEFAULTS, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out))
    print("wrote", DEFAULTS)


def main():
    fx = {}
    count = make_count(20261027, 200, 0.6)
    fx["count"] = {"data": count, "preds": ["age", "income", "female"], "exposure": "years", **count_oracle(count, ["age", "income", "female"], "years")}
    tob = make_tobit(1987, 200)
    fx["tobit"] = {"data": tob, "preds": ["educ", "age", "kids"], "lower": 0, **tobit_oracle(tob, ["educ", "age", "kids"], 0.0, None)}
    hk = make_heckman(1979, 300)
    fx["heckman"] = {"data": hk, "x": ["educ", "exper"], "z": ["educ", "exper", "kids", "married"], **heckman_oracle(hk, ["educ", "exper"], ["educ", "exper", "kids", "married"])}
    od = make_ordered(2026, 250)
    fx["ordered"] = {"data": od, "preds": ["price", "quality", "online"],
                     "logit": ordered_oracle(od, ["price", "quality", "online"], "logit"),
                     "probit": ordered_oracle(od, ["price", "quality", "online"], "probit")}
    mn = make_mnl(1993, 300)
    fx["mnl"] = {"data": mn, "preds": ["income", "age"], "base1": mnl_oracle(mn, ["income", "age"], 1.0), "base2": mnl_oracle(mn, ["income", "age"], 2.0)}

    # ---- held out for the adversarial pass (second seeds and edge cases)
    adv = {}
    c2 = make_count(4242, 300, 0.0)  # Poisson-generated
    adv["countPoisson"] = {"data": c2, **count_oracle(c2, ["age", "income", "female"], "years")}
    c3 = make_count(777, 150, 1.2)
    c4 = make_count(31415, 250, 0.3, shift=4.5)  # counts in the hundreds: the lgamma/digamma path (y > 64)
    adv["countLarge"] = {"data": c4, **count_oracle(c4, ["age", "income", "female"], "years")}
    adv["countNoConst"] = {"data": c3, **count_oracle(c3, ["age", "female"], None, constant=False)}
    adv["countNoExposure"] = {"data": c3, **count_oracle(c3, ["age", "income", "female"], None)}
    t2 = make_tobit(31337, 180, upper_only=True)
    adv["tobitUpper"] = {"data": t2, "upper": 15, **tobit_oracle(t2, ["educ", "age", "kids"], None, 15.0)}
    t3 = make_tobit(9001, 160)
    adv["tobitTwoLimit"] = {"data": t3, "lower": 0, "upper": 12, **tobit_oracle(t3, ["educ", "kids"], 0.0, 12.0)}
    h2 = make_heckman(2718, 400)
    adv["heckman2"] = {"data": h2, **heckman_oracle(h2, ["educ", "exper"], ["educ", "exper", "kids", "married"])}
    # No exclusion restriction: identification by functional form only; the two-step rho leaves [-1, 1] (truncated).
    adv["heckmanTrunc"] = {"data": hk, **heckman_oracle(hk, ["educ", "exper"], ["educ", "exper"])}
    o2 = make_ordered(55, 200, J=3)
    adv["ordered3"] = {"data": o2, "probit": ordered_oracle(o2, ["price", "online"], "probit")}
    o3 = make_ordered(66, 220, J=2)
    adv["ordered2"] = {"data": o3, "probit": ordered_oracle(o3, ["price", "quality"], "probit"),
                       "logit": ordered_oracle(o3, ["price", "quality"], "logit"), "binary": binary_probit_logit(o3, ["price", "quality"], 1.0)}
    m2 = make_mnl(8080, 260)
    adv["mnlBase3"] = {"data": m2, "fit": mnl_oracle(m2, ["income", "age"], 3.0)}
    fx["adv"] = adv
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(fx, f, indent=1)
    print("wrote", OUT)
    write_defaults(fx)
    for k in ("count", "tobit", "ordered", "mnl"):
        pass
    print("count Poisson score", fx["count"]["poisson"]["scoreMax"], "NB2" in fx["count"] or "nb2" in fx["count"])
    print("tobit score", fx["tobit"]["scoreMax"], "censored", fx["tobit"]["nLeft"])
    print("heckman nSel", fx["heckman"]["nSel"], "rho", fx["heckman"]["rho"])
    print("ordered score", fx["ordered"]["logit"]["scoreMax"], fx["ordered"]["probit"]["scoreMax"])
    print("mnl score", fx["mnl"]["base1"]["scoreMax"])
    print("adv countPoisson nb2?", "nb2" in adv["countPoisson"], adv["countPoisson"]["poisson"]["alphaScoreAt0"])


if __name__ == "__main__":
    main()
