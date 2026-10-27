"""
Oracle for src/lib/causalStatCalcs.ts (release F2, gap item #12): writes src/lib/__tests__/fixtures/causal-oracle.json.

Run:  ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/causal-oracle.py

Independence: nothing here imports or reads the TypeScript. rdrobust and pysyncon are not installed, so
  - RD fits: statsmodels WLS(cov_type="HC1") for the sharp jump, linearmodels IV2SLS(weights, robust, debiased) for the
    fuzzy ratio (library outputs);
  - the Imbens-Kalyanaraman bandwidth: a numpy re-implementation written from NBER WP 14726 (2009), sec. 4.2, with the
    kernel constant C_K computed here by quadrature from IK Lemma 3.1;
  - synthetic control: cvxpy (Clarabel) on the same objective (pre-period squared gap + the same tiny ridge), and
    placebo ratios / permutation p by a plain loop;
  - propensity score: statsmodels Logit, brute-force numpy matching (full distance matrices, lexsort tie-break), IPW
    estimates and an M-estimation sandwich whose Jacobian is taken NUMERICALLY (central differences), not analytically.
The worked-default tables are regenerated with the same integer LCG as the TypeScript and must match byte for byte.
"""
import json
import math
import os

import numpy as np
import statsmodels.api as sm
import cvxpy as cp
from scipy.integrate import quad
from linearmodels.iv import IV2SLS

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "lib", "__tests__", "fixtures", "causal-oracle.json")


# ------------------------------------------------------------------------------------------------ the LCG defaults
class Lcg:
    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFF

    def u(self):
        self.s = (self.s * 1664525 + 1013904223) % 4294967296
        return (self.s + 0.5) / 4294967296

    def g(self):
        s = 0.0
        for _ in range(12):
            s += self.u()
        return s - 6


def fmt_int(k, d):
    sign = "-" if k < 0 else ""
    a = abs(k)
    if d == 0:
        return sign + str(a)
    p = 10 ** d
    return f"{sign}{a // p}.{str(a % p).rjust(d, '0')}"


def rd_default():
    r = Lcg(20261027)
    lines = ["score\toutcome\ttreated"]
    for _ in range(1000):
        k = math.floor(r.u() * 1000)
        d = k >= 500
        treated = 1 if r.u() < (0.85 if d else 0.15) else 0
        xc = (k - 500) / 10
        yv = 40 + 0.25 * xc - 0.002 * xc * xc + 6 * treated + 2 * r.g()
        yk = math.floor(yv * 100 + 0.5)
        lines.append("\t".join([fmt_int(k, 1), fmt_int(yk, 2), str(treated)]))
    return "\n".join(lines)


def sc_default():
    r = Lcg(20261026)
    J, T = 12, 30
    a, b1, b2 = [], [], []
    for _ in range(J):
        a.append(50 + math.floor(r.u() * 40))
        b1.append(0.5 + r.u())
        b2.append(r.u() * 2)
    f2 = []
    walk = 0.0
    for _ in range(T):
        walk += r.g()
        f2.append(walk)
    names = [f"Region {ch}" for ch in "ABCDEFGHIJKLM"]
    lines = ["\t".join(["Year"] + names)]
    for t in range(T):
        sys_ = [a[j] + b1[j] * t + b2[j] * f2[t] for j in range(J)]
        treated = 0.4 * sys_[0] + 0.35 * sys_[1] + 0.25 * sys_[2] + 0.5 * r.g() - (0.8 * (t - 19) if t >= 20 else 0)
        row = [str(1990 + t), fmt_int(math.floor(treated * 10 + 0.5), 1)]
        for j in range(J):
            row.append(fmt_int(math.floor((sys_[j] + r.g()) * 10 + 0.5), 1))
        lines.append("\t".join(row))
    return "\n".join(lines)


def ps_default():
    r = Lcg(20261028)
    lines = ["earnings\ttraining\tage\teduc\tincome"]
    for _ in range(400):
        age = 20 + math.floor(r.u() * 41)
        educ = 8 + math.floor(r.u() * 11)
        inc = 10 + math.floor(r.u() * 81)
        s = (0.5 * (educ - 13)) / 5 + (0.3 * (age - 40)) / 20 - (0.4 * (inc - 50)) / 40
        p = min(0.95, max(0.05, 0.35 + 0.35 * s))
        tr = 1 if r.u() < p else 0
        yv = 10 + 0.8 * educ + 0.05 * age + 0.1 * inc + 2.5 * tr + 3 * r.g()
        lines.append("\t".join([fmt_int(math.floor(yv * 100 + 0.5), 2), str(tr), str(age), str(educ), str(inc)]))
    return "\n".join(lines)


def table(text):
    rows = [l.split("\t") for l in text.split("\n")]
    head = rows[0]
    data = np.array([[float(v) for v in r] for r in rows[1:]])
    return head, data


def to_text(head, cols, decimals):
    lines = ["\t".join(head)]
    for i in range(len(cols[0])):
        lines.append("\t".join(f"{cols[j][i]:.{decimals[j]}f}" for j in range(len(head))))
    return "\n".join(lines)


# ------------------------------------------------------------------------------------------------ RD
def ck(kernel):
    K = {"triangular": lambda u: 1 - u, "uniform": lambda u: 0.5, "epanechnikov": lambda u: 0.75 * (1 - u * u)}[kernel]
    nu = [quad(lambda u, j=j: u ** j * K(u), 0, 1)[0] for j in range(4)]
    pi = [quad(lambda u, j=j: u ** j * K(u) ** 2, 0, 1)[0] for j in range(3)]
    D = nu[2] * nu[0] - nu[1] ** 2
    C1 = 0.5 * (nu[2] ** 2 - nu[1] * nu[3]) / D
    C2 = (nu[2] ** 2 * pi[0] - 2 * nu[1] * nu[2] * pi[1] + nu[1] ** 2 * pi[2]) / D ** 2
    return (C2 / (4 * C1 ** 2)) ** 0.2


def ik(x, y, c, kernel):
    n = len(x)
    h1 = 1.84 * np.std(x, ddof=1) * n ** -0.2
    L = (x >= c - h1) & (x < c)
    R = (x >= c) & (x <= c + h1)
    f = (L.sum() + R.sum()) / (2 * n * h1)
    s2 = (((y[L] - y[L].mean()) ** 2).sum() + ((y[R] - y[R].mean()) ** 2).sum()) / (L.sum() + R.sum())
    mL, mR = np.median(x[x < c]), np.median(x[x >= c])
    S = (x >= mL) & (x <= mR)
    u = x[S] - c
    Xc = np.column_stack([np.ones(S.sum()), (x[S] >= c).astype(float), u, u ** 2, u ** 3])
    m3 = 6 * np.linalg.lstsq(Xc, y[S], rcond=None)[0][4]
    Np, Nm = (x >= c).sum(), (x < c).sum()
    h2p = 3.56 * (s2 / (f * max(m3 ** 2, 0.01))) ** (1 / 7) * Np ** (-1 / 7)
    h2m = 3.56 * (s2 / (f * max(m3 ** 2, 0.01))) ** (1 / 7) * Nm ** (-1 / 7)

    def curv(mask):
        uu = x[mask] - c
        return 2 * np.linalg.lstsq(np.column_stack([np.ones(mask.sum()), uu, uu ** 2]), y[mask], rcond=None)[0][2], mask.sum()

    m2p, n2p = curv((x >= c) & (x <= c + h2p))
    m2m, n2m = curv((x >= c - h2m) & (x < c))
    rp = 720 * s2 / (n2p * h2p ** 4)
    rm = 720 * s2 / (n2m * h2m ** 4)
    h = ck(kernel) * (2 * s2 / (f * ((m2p - m2m) ** 2 + rp + rm))) ** 0.2 * n ** -0.2
    return dict(h=h, h1=h1, f=f, sigma2=s2, m3=m3, h2p=h2p, h2m=h2m, m2p=m2p, m2m=m2m, rp=rp, rm=rm)


def kern(kernel, v):
    a = np.abs(v)
    if kernel == "uniform":
        return np.where(a <= 1, 0.5, 0.0)
    if kernel == "triangular":
        return np.where(a < 1, 1 - a, 0.0)
    return np.where(a < 1, 0.75 * (1 - a * a), 0.0)


def rd(x, y, t, c, h, kernel, order):
    w = kern(kernel, (x - c) / h)
    m = w > 0
    u = x[m] - c
    D = (x[m] >= c).astype(float)
    cols = [np.ones(m.sum()), D, u, D * u] + ([u ** 2, D * u ** 2] if order == 2 else [])
    X = np.column_stack(cols)
    fy = sm.WLS(y[m], X, weights=w[m]).fit(cov_type="HC1")
    out = dict(nL=int((D == 0).sum()), nR=int((D == 1).sum()), rf=float(fy.params[1]), rfSe=float(fy.bse[1]))
    if t is None:
        out.update(tau=out["rf"], se=out["rfSe"])
        return out
    ft = sm.WLS(t[m], X, weights=w[m]).fit(cov_type="HC1")
    exog = np.column_stack([c_ for k, c_ in enumerate(cols) if k != 1])
    iv = IV2SLS(y[m], exog, t[m].reshape(-1, 1), D.reshape(-1, 1), weights=w[m]).fit(cov_type="robust", debiased=True)
    out.update(fs=float(ft.params[1]), fsSe=float(ft.bse[1]), tau=float(iv.params.iloc[-1]), se=float(iv.std_errors.iloc[-1]))
    return out


# ------------------------------------------------------------------------------------------------ synthetic control
RIDGE = 1e-8


def sc_weights(z1, Z):
    J = Z.shape[1]
    lam = RIDGE * np.trace(Z.T @ Z) / J
    w = cp.Variable(J)
    prob = cp.Problem(cp.Minimize(cp.sum_squares(z1 - Z @ w) + lam * cp.sum_squares(w)), [w >= 0, cp.sum(w) == 1])
    prob.solve(solver=cp.CLARABEL, tol_gap_abs=1e-12, tol_gap_rel=1e-12, tol_feas=1e-12)
    ww = np.maximum(np.array(w.value), 0)
    return ww / ww.sum()


def sc(Y, T0, placebo=True):
    U = Y.shape[1]

    def run(ti, dj):
        w = sc_weights(Y[:T0, ti], Y[:T0, dj])
        synth = Y[:, dj] @ w
        gap = Y[:, ti] - synth
        return w, synth, gap, math.sqrt(np.mean(gap[:T0] ** 2)), math.sqrt(np.mean(gap[T0:] ** 2))

    donors = list(range(1, U))
    w, synth, gap, pre, post = run(0, donors)
    out = dict(w=w.tolist(), synth=synth.tolist(), pre=pre, post=post, ratio=post / pre)
    if placebo:
        ratios = []
        for j in donors:
            _, _, _, p1, p2 = run(j, [k for k in donors if k != j])
            ratios.append(p2 / p1)
        out["placeboRatios"] = ratios
        rank = 1 + sum(1 for r in ratios if r >= out["ratio"] * (1 - 1e-12))
        out.update(rank=rank, p=rank / U)
    return out


# ------------------------------------------------------------------------------------------------ propensity score
def logit(T, X):
    m = sm.Logit(T, sm.add_constant(X, prepend=True)).fit(disp=0, tol=1e-12, maxiter=200)
    eta = sm.add_constant(X, prepend=True) @ m.params
    return np.asarray(m.params), eta, 1 / (1 + np.exp(-eta))


def match(eta, T, Y, estimand, k, replace, caliper):
    n = len(T)
    it, ic = np.where(T == 1)[0], np.where(T == 0)[0]
    w = np.zeros(n)
    diffs = []
    if estimand == "att" and not replace:
        free = set(ic.tolist())
        order = sorted(it.tolist(), key=lambda i: (-eta[i], i))
        for i in order:
            cands = sorted(free, key=lambda j: (abs(eta[i] - eta[j]), j))
            if not cands or abs(eta[i] - eta[cands[0]]) > caliper:
                continue
            j = cands[0]
            free.discard(j)
            w[i] = 1
            w[j] += 1
            diffs.append(Y[i] - Y[j])
        return float(np.mean(diffs)), w
    own = np.zeros(n)

    def side(src, pool, sign):
        for i in src:
            d = np.abs(eta[pool] - eta[i])
            idx = np.lexsort((pool, d))[:k]
            mm = [pool[q] for q in idx if d[q] <= caliper]
            if not mm:
                continue
            own[i] = 1
            for j in mm:
                w[j] += 1 / len(mm)
            diffs.append(sign * (Y[i] - np.mean(Y[mm])))

    side(it, ic, 1)
    if estimand == "ate":
        side(ic, it, -1)
    return float(np.mean(diffs)), w + own


def ipw_psi(theta, Xc, T, Y, estimand, kind):
    p = Xc.shape[1]
    beta, mu1, mu0 = theta[:p], theta[p], theta[p + 1]
    e = 1 / (1 + np.exp(-(Xc @ beta)))
    w1 = 1 / e if estimand == "ate" else np.ones_like(e)
    w0 = 1 / (1 - e) if estimand == "ate" else e / (1 - e)
    psi_b = (T - e)[:, None] * Xc
    if kind == "hajek" or estimand == "att":
        psi1 = T * w1 * (Y - mu1)
    else:
        psi1 = T * w1 * Y - mu1
    if kind == "hajek":
        psi0 = (1 - T) * w0 * (Y - mu0)
    elif estimand == "ate":
        psi0 = (1 - T) * w0 * Y - mu0
    else:
        psi0 = (1 - T) * w0 * Y - T * mu0
    return np.column_stack([psi_b, psi1, psi0])


def ipw(Xc, T, Y, beta, estimand, kind):
    e = 1 / (1 + np.exp(-(Xc @ beta)))
    w1 = 1 / e if estimand == "ate" else np.ones_like(e)
    w0 = 1 / (1 - e) if estimand == "ate" else e / (1 - e)
    if kind == "hajek":
        mu1 = np.sum(T * w1 * Y) / np.sum(T * w1)
        mu0 = np.sum((1 - T) * w0 * Y) / np.sum((1 - T) * w0)
    else:
        den = len(T) if estimand == "ate" else T.sum()
        mu1 = np.sum(T * w1 * Y) / den
        mu0 = np.sum((1 - T) * w0 * Y) / den
    theta = np.concatenate([beta, [mu1, mu0]])
    n = len(T)
    dim = len(theta)
    Aj = np.zeros((dim, dim))
    for j in range(dim):
        hstep = 1e-6 * max(1.0, abs(theta[j]))
        tp, tm = theta.copy(), theta.copy()
        tp[j] += hstep
        tm[j] -= hstep
        Aj[:, j] = (ipw_psi(tp, Xc, T, Y, estimand, kind).mean(0) - ipw_psi(tm, Xc, T, Y, estimand, kind).mean(0)) / (2 * hstep)
    psi = ipw_psi(theta, Xc, T, Y, estimand, kind)
    B = psi.T @ psi / n
    Ai = np.linalg.inv(-Aj)
    V = Ai @ B @ Ai.T / n
    c = np.zeros(dim)
    c[-2], c[-1] = 1, -1
    return dict(est=float(mu1 - mu0), se=float(math.sqrt(c @ V @ c)), mu1=float(mu1), mu0=float(mu0))


# ------------------------------------------------------------------------------------------------ cases
def main():
    out = {"defaults": {"rd": rd_default(), "sc": sc_default(), "ps": ps_default()}, "rd": [], "sc": [], "ps": [], "ck": {}}
    for k in ("triangular", "epanechnikov", "uniform"):
        out["ck"][k] = ck(k)

    # RD on the default, and on a second dataset with an integer running variable (ties at the cutoff) and a curved
    # outcome, generated here with numpy (written to the fixture as text).
    head, D = table(out["defaults"]["rd"])
    x, y, t = D[:, 0], D[:, 1], D[:, 2]
    rng = np.random.default_rng(7)
    x2 = rng.integers(-60, 61, 1500).astype(float)
    t2 = (rng.random(1500) < np.where(x2 >= 0, 0.7, 0.2)).astype(float)
    y2 = np.round(10 + 0.05 * x2 + 0.002 * x2 ** 2 - 0.00002 * x2 ** 3 + 3 * t2 + rng.normal(0, 1.5, 1500), 3)
    data2 = to_text(["age", "y", "t"], [x2, y2, t2], [0, 3, 0])
    for name, text, xx, yy, tt, c in (("default", out["defaults"]["rd"], x, y, t, 50.0), ("integer", data2, x2, y2, t2, 0.0)):
        for kernel in ("triangular", "epanechnikov", "uniform"):
            s = ik(xx, yy, c, kernel)
            case = dict(data=name, kernel=kernel, cutoff=c, ik=s, sharp=rd(xx, yy, None, c, s["h"], kernel, 1), fuzzy=rd(xx, yy, tt, c, s["h"], kernel, 1))
            out["rd"].append(case)
        hq = 25.0 if name == "integer" else 15.0
        out["rd"].append(dict(data=name, kernel="triangular", cutoff=c, order=2, h=hq, sharp=rd(xx, yy, None, c, hq, "triangular", 2), fuzzy=rd(xx, yy, tt, c, hq, "triangular", 2)))
    out["rdData"] = {"integer": data2}

    # Synthetic control: the default (J = 12 < T0 = 20) and a wide pool (J = 30 donors > T0 = 8 pre-periods).
    head, D = table(out["defaults"]["sc"])
    case = sc(D[:, 1:], int((D[:, 0] < 2010).sum()))
    case["data"] = "default"
    out["sc"].append(case)
    rng = np.random.default_rng(11)
    T, J, T0 = 14, 30, 8
    F = np.cumsum(rng.normal(0, 1, (T, 2)), axis=0)
    L = rng.uniform(0.2, 1.5, (2, J))
    Yd = np.round(20 + F @ L + rng.normal(0, 0.3, (T, J)), 2)
    wt = np.zeros(J)
    wt[[0, 4, 9]] = [0.5, 0.3, 0.2]
    y1 = np.round(Yd @ wt + rng.normal(0, 0.2, T) - np.where(np.arange(T) >= T0, 2.0, 0.0), 2)
    Yw = np.column_stack([y1, Yd])
    names = ["Year", "Treated"] + [f"D{j + 1:02d}" for j in range(J)]
    years = np.arange(2000, 2000 + T).astype(float)
    data_sc2 = to_text(names, [years] + [Yw[:, j] for j in range(J + 1)], [0] + [2] * (J + 1))
    case = sc(Yw, T0)
    case["data"] = "wide"
    out["sc"].append(case)
    out["scData"] = {"wide": data_sc2}
    # Near-collinear pools (rank-3 factor model, low noise): the case on which the F1 active-set QP cycled.
    rng = np.random.default_rng(23)
    T, J = 40, 40
    F = np.cumsum(rng.uniform(-0.5, 0.5, (T, 3)), axis=0)
    L = rng.uniform(0, 1, (3, J))
    Yd = np.round(10 + F @ L + rng.uniform(0, 0.1, (T, J)), 4)
    y1 = np.round(0.3 * Yd[:, 0] + 0.3 * Yd[:, 5] + 0.4 * Yd[:, 11] + rng.uniform(0, 0.05, T) - np.where(np.arange(T) >= 30, 1.0, 0.0), 4)
    Yw = np.column_stack([y1, Yd])
    names = ["t", "Treated"] + [f"U{j + 1}" for j in range(J)]
    data_c = to_text(names, [np.arange(1, T + 1).astype(float)] + [Yw[:, j] for j in range(J + 1)], [0] + [4] * (J + 1))
    out["scData"]["collinear"] = data_c
    for T0 in (30, 5):
        case = sc(Yw, T0)
        case["data"] = "collinear"
        case["start"] = T0 + 1
        out["sc"].append(case)

    # Propensity score on the default.
    head, D = table(out["defaults"]["ps"])
    Y, T, X = D[:, 0], D[:, 1], D[:, 2:]
    beta, eta, e = logit(T, X)
    out["psScore"] = dict(beta=beta.tolist(), e=e.tolist(), eta=eta.tolist())
    sd = np.std(eta, ddof=1)
    for est, k, rep, cal in (("att", 1, True, None), ("ate", 3, True, None), ("att", 1, False, 0.2), ("att", 2, True, 0.05), ("ate", 1, True, 0.1)):
        calv = math.inf if cal is None else cal * sd
        m, w = match(eta, T, Y, est, k, rep, calv)
        out["ps"].append(dict(method="match", estimand=est, k=k, replace=rep, caliper=cal, est=m, w=w.tolist()))
    Xc = np.column_stack([np.ones(len(T)), X])
    for est in ("att", "ate"):
        for kind in ("hajek", "ht"):
            r = ipw(Xc, T, Y, beta, est, kind)
            out["ps"].append(dict(method="ipw", estimand=est, weights=kind, **r))
    # Trimming (Crump 0.1-0.9), then refit, then IPW ATE Hajek: the calculator's full path.
    keep = (e >= 0.1) & (e <= 0.9)
    b2, eta2, e2 = logit(T[keep], X[keep])
    r = ipw(np.column_stack([np.ones(keep.sum()), X[keep]]), T[keep], Y[keep], b2, "ate", "hajek")
    out["ps"].append(dict(method="ipw", estimand="ate", weights="hajek", trim="crump", trimmed=int((~keep).sum()), **r))
    keep2 = (e >= max(e[T == 1].min(), e[T == 0].min())) & (e <= min(e[T == 1].max(), e[T == 0].max()))
    b3, eta3, e3 = logit(T[keep2], X[keep2])
    sd3 = np.std(eta3, ddof=1)
    m, _ = match(eta3, T[keep2], Y[keep2], "att", 1, True, math.inf)
    out["ps"].append(dict(method="match", estimand="att", k=1, replace=True, caliper=None, trim="overlap", trimmed=int((~keep2).sum()), est=m))

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", OUT)
    for c in out["rd"]:
        print("rd", c["data"], c["kernel"], c.get("order", 1), round(c.get("ik", {}).get("h", c.get("h", 0)), 5), round(c["sharp"]["tau"], 5), round(c["fuzzy"]["tau"], 5))
    for c in out["sc"]:
        print("sc", c["data"], round(c["pre"], 6), round(c["ratio"], 5), c.get("rank"), c.get("p"))
    for c in out["ps"]:
        print("ps", c["method"], c["estimand"], c.get("k"), c.get("weights"), c.get("trim"), round(c["est"], 6), round(c.get("se", 0), 6))


if __name__ == "__main__":
    main()
