"""Oracle for release F2 items #14 (Micro II) and #15 (Macro II): src/lib/micromacro.ts + micromacroStatCalcs.ts.

Run:  ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/micromacro-oracle.py
Writes src/lib/__tests__/fixtures/micromacro-oracle.json (and prints the synthetic Phillips table, which is the
calculator's default; seed 20261027).

Every value is derived here independently of the TypeScript:
  demand        closed forms evaluated with sympy at 30 digits (Q = A P^eps; Q = exp(a - bP)); monopoly price by
                sympy.solve of d/dP[(P - c) Q(P)] = 0.
  consumer      sympy: Marshallian demand by solving the Lagrangian first-order conditions (Cobb-Douglas, CES), by the
                kink / corner conditions (complements, substitutes); Hicksian demand by MINIMISING expenditure subject
                to U = u0 (its own first-order conditions, not x(p, e(p, u))); Slutsky bundle at m' = m + dp1 * x1.
  cost          sympy: min AVC and min AC by solving their derivatives, output at P by solving MC = P.
  price disc    sympy: third degree by MR = MC per market; uniform by maximising (P - c) Q(P) on each segment of the
                kinked aggregate demand with sympy.solve + endpoint checks; first degree from the surplus triangles.
  auction       sympy: E[revenue] of the first-price auction = integral of b(v) times the density of the highest value
                over [r, hi]; of the second-price auction = E[max(second highest, r); highest >= r] by integrating over
                the joint density of the top two order statistics. Bids from the closed form b(v).
  growth        numpy on the default table.
  Mundell-F.    sympy.linsolve of the IS, LM, BP equations.
  multipliers   sympy Rationals.
  Phillips      statsmodels 0.15 OLS (nonrobust, HC1, HAC maxlags = floor(4(n/100)^(2/9)) use_correction=True,
                use_t=True); NAIRU = -a/b and its delta-method SE from cov_params() and the gradient (-1/b, a/b^2).
"""
import json
import math
import os

import numpy as np
import statsmodels.api as sm
import sympy as sp

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "lib", "__tests__", "fixtures", "micromacro-oracle.json")
R = sp.Rational


def f(x):
    return float(sp.N(x, 30))


out = {}

# ------------------------------------------------------------------------------------------------ demand
P = sp.symbols("P", positive=True)


def demand_case(form, params, p0, c):
    if form == "loglog":
        A, e = params
        Q = A * P**e
        eps = e
    else:
        a, b = params
        Q = sp.exp(a - b * P)
        eps = -b * P
    res = {"form": form, "params": [str(x) for x in params], "p": str(p0), "c": str(c) if c is not None else None}
    res["q"] = f(Q.subs(P, p0))
    res["eps"] = f(sp.sympify(eps).subs(P, p0))
    res["rev"] = f((P * Q).subs(P, p0))
    res["mr"] = f((P * (1 + 1 / sp.sympify(eps))).subs(P, p0))
    if form == "semilog":
        pr = sp.solve(sp.diff(P * Q, P), P)[0]
        res["pR"] = f(pr)
        res["qR"] = f(Q.subs(P, pr))
        res["revMax"] = f((P * Q).subs(P, pr))
    if c is not None:
        sol = [s for s in sp.solve(sp.diff((P - c) * Q, P), P) if s.is_positive]
        if sol:
            ps = sol[0]
            res["pStar"] = f(ps)
            res["qStar"] = f(Q.subs(P, ps))
            res["profit"] = f(((P - c) * Q).subs(P, ps))
    return res


out["demand"] = [
    demand_case("loglog", (R(1000), R(-3, 2)), R(8), R(4)),
    demand_case("semilog", (R(5), R(1, 10)), R(8), R(4)),
    demand_case("loglog", (R(250), R(-5, 2)), R(3), R(1)),
    demand_case("semilog", (R(3), R(1, 4)), R(2), R(1, 2)),
]

# ------------------------------------------------------------------------------------------------ consumer
x, y, lam = sp.symbols("x y lam", positive=True)


def U_of(kind, a, b, rho):
    if kind == "cd":
        return x**a * y**b
    if kind == "ces":
        return (a * x**rho + b * y**rho) ** (1 / rho)
    raise ValueError


def marshall_smooth(kind, a, b, rho, p1, p2, m):
    U = U_of(kind, a, b, rho)
    # MRS = p1/p2 and the budget line (log utility for Cobb-Douglas keeps sympy fast)
    mrs = sp.simplify(sp.diff(U, x) / sp.diff(U, y))
    sols = sp.solve([sp.Eq(mrs, p1 / p2), sp.Eq(p1 * x + p2 * y, m)], [x, y], dict=True)
    s = sols[0]
    return s[x], s[y]


def hicks_smooth(kind, a, b, rho, p1, p2, u0):
    # minimise p1 x + p2 y subject to U(x, y) = u0: tangency and the utility constraint
    U = U_of(kind, a, b, rho)
    mrs = sp.simplify(sp.diff(U, x) / sp.diff(U, y))
    yx = sp.solve(sp.Eq(mrs, p1 / p2), y)[0]
    xs = sp.nsolve(U.subs(y, yx) - u0, x, 1.0, prec=30)
    return xs, yx.subs(x, xs)


def consumer_case(kind, a, b, rho, m, p1, p1n, p2):
    res = {"kind": kind, "a": str(a), "b": str(b), "rho": str(rho) if rho is not None else None, "m": str(m), "p1": str(p1), "p1new": str(p1n), "p2": str(p2)}
    if kind in ("cd", "ces"):
        U = U_of(kind, a, b, rho)
        A = marshall_smooth(kind, a, b, rho, p1, p2, m)
        C = marshall_smooth(kind, a, b, rho, p1n, p2, m)
        u0 = U.subs({x: A[0], y: A[1]})
        u1 = U.subs({x: C[0], y: C[1]})
        B = hicks_smooth(kind, a, b, rho, p1n, p2, u0)
        mS = m + (p1n - p1) * A[0]
        S = marshall_smooth(kind, a, b, rho, p1n, p2, mS)
        Bo = hicks_smooth(kind, a, b, rho, p1, p2, u1)
        e1 = p1n * B[0] + p2 * B[1]
        e0u1 = p1 * Bo[0] + p2 * Bo[1]
    elif kind == "leontief":
        def mar(pp, mm):
            t = mm / (pp / a + p2 / b)
            return (t / a, t / b)
        A = mar(p1, m)
        C = mar(p1n, m)
        u0 = sp.Min(a * A[0], b * A[1])
        u1 = sp.Min(a * C[0], b * C[1])
        B = (u0 / a, u0 / b)
        e1 = p1n * B[0] + p2 * B[1]
        e0u1 = p1 * u1 / a + p2 * u1 / b
        mS = m + (p1n - p1) * A[0]
        S = mar(p1n, mS)
    else:
        def mar(pp, mm):
            return (mm / pp, R(0)) if a / pp > b / p2 else (R(0), mm / p2)
        A = mar(p1, m)
        C = mar(p1n, m)
        u0 = a * A[0] + b * A[1]
        u1 = a * C[0] + b * C[1]
        e1 = u0 / max(a / p1n, b / p2)
        B = mar(p1n, e1)
        e0u1 = u1 / max(a / p1, b / p2)
        mS = m + (p1n - p1) * A[0]
        S = mar(p1n, mS)
    for k, v in (("A", A), ("B", B), ("C", C), ("S", S)):
        res[k] = [f(v[0]), f(v[1])]
    res["u0"] = f(u0)
    res["u1"] = f(u1)
    res["eHicks"] = f(e1)
    res["mSlutsky"] = f(mS)
    res["cv"] = f(e1 - m)
    res["ev"] = f(m - e0u1)
    return res


out["consumer"] = [
    consumer_case("cd", R(1, 2), R(1, 2), None, R(100), R(2), R(4), R(1)),
    consumer_case("cd", R(3, 10), R(3, 5), None, R(120), R(3), R(2), R(3, 2)),
    consumer_case("ces", R(1, 2), R(1, 2), R(1, 2), R(100), R(2), R(4), R(1)),
    consumer_case("ces", R(2), R(1), R(-1), R(90), R(1), R(3, 2), R(2)),
    consumer_case("leontief", R(1), R(2), None, R(100), R(2), R(4), R(1)),
    consumer_case("linear", R(2), R(1), None, R(100), R(1), R(4), R(1)),
]

# ------------------------------------------------------------------------------------------------ cost
qq = sp.symbols("q", positive=True)


def cost_case(coefs, price):
    TC = sum(sp.nsimplify(c) * qq**k for k, c in enumerate(coefs))
    VC = TC - TC.subs(qq, 0)
    AVC = sp.expand(VC / qq)
    AC = TC / qq
    MC = sp.diff(TC, qq)
    res = {"coefs": [str(c) for c in coefs], "price": str(price) if price is not None else None}
    crit = [s for s in sp.solve(sp.diff(AVC, qq), qq) if s.is_real and s > 0]
    if crit:
        qs = min(crit, key=lambda s: f(AVC.subs(qq, s)))
        if f(AVC.subs(qq, qs)) < f(AVC.subs(qq, 0)):
            res["shutdownQ"] = f(qs)
            res["shutdownP"] = f(AVC.subs(qq, qs))
    if "shutdownQ" not in res:
        res["shutdownQ"] = 0.0
        res["shutdownP"] = f(AVC.subs(qq, 0))
    # min AC: the positive real roots of the numerator of AC' (q TC' - TC), by nroots (sympy.solve misses quartics)
    qv = sp.symbols("qv")
    num = sp.Poly(sp.expand(qq * MC - TC).subs(qq, qv), qv)
    be = [sp.re(s) for s in sp.Poly(num, qv).nroots(n=30) if abs(sp.im(s)) < 1e-20 and sp.re(s) > 0]
    if be:
        qb = min(be, key=lambda s: f(AC.subs(qq, s)))
        res["breakEvenQ"] = f(qb)
        res["breakEvenP"] = f(AC.subs(qq, qb))
    if price is not None:
        # positive real roots of MC(q) - P by nroots (sympy.solve gives unreadable radicals for a cubic MC)
        mcp = sp.Poly(sp.expand(MC - price).subs(qq, qv), qv)
        sols = [sp.re(s) for s in mcp.nroots(n=30) if abs(sp.im(s)) < 1e-20 and sp.re(s) > 0]
        if sols and price >= res["shutdownP"]:
            qp = max(sols, key=f)
            res["supplyQ"] = f(qp)
            res["profit"] = f(price * qp - TC.subs(qq, qp))
    return res


out["cost"] = [
    cost_case([300, 12, -2, R(1, 4)], R(50)),
    cost_case([100, 20, -3, R(1, 5)], R(30)),
    cost_case([50, 5, R(1, 2)], R(15)),
    cost_case([200, 30, -2, R(-1, 20), R(1, 100)], R(40)),  # a quartic with MC > 0 throughout
]

# ------------------------------------------------------------------------------------------------ price discrimination


def pd_case(a1, b1, a2, b2, c):
    Pp = sp.symbols("Pp", real=True)
    mk = [(a1, b1), (a2, b2)]
    res = {"in": [str(v) for v in (a1, b1, a2, b2, c)]}
    q3 = [max((a - c) / (2 * b), 0) for a, b in mk]
    p3 = [a - b * q for (a, b), q in zip(mk, q3)]
    res["third"] = {"q": [f(v) for v in q3], "p": [f(v) for v in p3], "profit": f(sum((p - c) * q for p, q in zip(p3, q3)))}
    q1 = [max((a - c) / b, 0) for a, b in mk]
    res["first"] = {"q": [f(v) for v in q1], "profit": f(sum(max(a - c, 0) * q / 2 for (a, b), q in zip(mk, q1)))}
    # uniform: candidate prices = stationary points on each segment + all breakpoints, profit evaluated exactly
    def Q(pv):
        return sum(max((a - pv) / b, 0) for a, b in mk)
    cands = {c, a1, a2, max(a1, a2)}
    lo_a, hi_a = sorted([a1, a2])
    hb = b1 if a1 >= a2 else b2
    cands.add((hi_a + c) / 2)
    A = a1 / b1 + a2 / b2
    B = 1 / b1 + 1 / b2
    cands.add((A + B * c) / (2 * B))
    best = max((pv for pv in cands if pv >= c), key=lambda pv: (pv - c) * Q(pv))
    qs = [max((a - best) / b, 0) for a, b in mk]
    res["uniform"] = {"p": f(best), "q": [f(v) for v in qs], "profit": f((best - c) * Q(best))}
    cs = lambda qv, b: b * qv**2 / 2
    res["uniform"]["cs"] = f(sum(cs(qv, b) for qv, (a, b) in zip(qs, mk)))
    res["third"]["cs"] = f(sum(cs(qv, b) for qv, (a, b) in zip(q3, mk)))
    res["tsMax"] = f(sum(max(a - c, 0) ** 2 / (2 * b) for a, b in mk))
    return res


out["pricedisc"] = [
    pd_case(R(100), R(1), R(60), R(1, 2), R(20)),
    pd_case(R(100), R(1), R(30), R(1), R(20)),  # uniform serves only market 1
    pd_case(R(50), R(2), R(80), R(1), R(10)),
]

# ------------------------------------------------------------------------------------------------ auction
v, w = sp.symbols("v w", positive=True)


def auction_case(n, lo, hi, r):
    span = hi - lo
    F = (v - lo) / span
    fdens = 1 / span
    rr = max(r, lo)
    Fr = (rr - lo) / span
    # first price: b(v) = v - integral_r^v F(t)^(n-1) dt / F(v)^(n-1)  (envelope form, derived here)
    t = sp.symbols("t", positive=True)
    bid = v - sp.integrate(((t - lo) / span) ** (n - 1), (t, rr, v)) / F ** (n - 1)
    dens_max = n * F ** (n - 1) * fdens
    rev_fp = sp.integrate(sp.simplify(bid * dens_max), (v, rr, hi))
    # second price: joint density of (highest v, second w), w < v
    joint = n * (n - 1) * ((w - lo) / span) ** (n - 2) * fdens * fdens
    part1 = sp.integrate(sp.integrate(w * joint, (w, rr, v)), (v, rr, hi))  # second >= r: pay w
    part2 = sp.integrate(rr * n * Fr ** (n - 1) * fdens, (v, rr, hi))  # only highest >= r: pay r
    rev_sp = part1 + part2
    res = {"n": n, "lo": str(lo), "hi": str(hi), "r": str(r), "revFirst": str(sp.nsimplify(rev_fp)), "revSecond": str(sp.nsimplify(rev_sp)),
           "revFirstF": f(rev_fp), "revSecondF": f(rev_sp), "pSale": f(1 - Fr**n)}
    res["bids"] = [[f(vv), f(bid.subs(v, vv))] for vv in [rr + (hi - rr) * R(k, 4) for k in range(1, 5)]]
    return res


out["auction"] = [
    auction_case(4, R(0), R(100), R(0)),
    auction_case(4, R(0), R(100), R(50)),
    auction_case(3, R(10), R(40), R(25)),
    auction_case(2, R(0), R(1), R(1, 2)),
]

# ------------------------------------------------------------------------------------------------ growth accounting
G = np.array([
    [2014, 1000, 3000, 500], [2015, 1031, 3093, 505], [2016, 1058, 3189, 509], [2017, 1092, 3290, 515],
    [2018, 1124, 3394, 520], [2019, 1151, 3498, 524], [2020, 1118, 3571, 510], [2021, 1176, 3660, 518],
    [2022, 1212, 3770, 526], [2023, 1243, 3881, 531], [2024, 1275, 3995, 536]], dtype=float)
al = 0.35
for kind in ("log", "simple"):
    g = (lambda X: np.diff(np.log(X))) if kind == "log" else (lambda X: X[1:] / X[:-1] - 1)
    gY, gK, gL = g(G[:, 1]), g(G[:, 2]), g(G[:, 3])
    tfp = gY - al * gK - (1 - al) * gL
    out[f"growth_{kind}"] = {"gY": gY.tolist(), "capital": (al * gK).tolist(), "labour": ((1 - al) * gL).tolist(), "tfp": tfp.tolist(),
                             "mean": [gY.mean(), (al * gK).mean(), ((1 - al) * gL).mean(), tfp.mean()]}
la = np.log(G[:, 1]) - al * np.log(G[:, 2]) - (1 - al) * np.log(G[:, 3])
out["growth_tfpIndexLast"] = float(100 * np.exp(la[-1] - la[0]))

# ------------------------------------------------------------------------------------------------ Mundell-Fleming
Y_, r_, e_, M_ = sp.symbols("Y r e M")


def mf(params, regime, f_=None):
    p = {k: sp.nsimplify(v) for k, v in params.items()}
    IS = sp.Eq(Y_, p["C0"] + p["c"] * (Y_ - p["T"]) + p["I0"] - p["b"] * r_ + p["G"] + p["NX0"] + p["n"] * e_ - p["m"] * Y_)
    LM = sp.Eq(M_ / p["P"], p["k"] * Y_ - p["h"] * r_)
    BP = sp.Eq(r_, p["rw"]) if f_ is None else sp.Eq(p["NX0"] + p["n"] * e_ - p["m"] * Y_ + f_ * (r_ - p["rw"]), 0)
    if regime == "floating":
        sol = sp.solve([IS, LM.subs(M_, p["M"]), BP], [Y_, r_, e_], dict=True)[0]
        sol[M_] = p["M"]
    else:
        sol = sp.solve([IS.subs(e_, p["e0"]), LM, BP.subs(e_, p["e0"])], [Y_, r_, M_], dict=True)[0]
        sol[e_] = p["e0"]
    return {k: str(sol[s]) for k, s in (("Y", Y_), ("r", r_), ("e", e_), ("M", M_))}


MFP = dict(C0=200, c=R(3, 4), T=200, I0=300, b=25, G=250, NX0=-140, n=200, m=R(1, 10), M=600, P=1, k=R(1, 2), h=50, rw=4, e0=1)
mfo = {}
for fval, tag in ((None, "perfect"), (R(100), "imperfect")):
    for regime in ("floating", "fixed"):
        mfo[f"{tag}_{regime}_base"] = mf(MFP, regime, fval)
        mfo[f"{tag}_{regime}_dG"] = mf({**MFP, "G": 300}, regime, fval)
    mfo[f"{tag}_floating_dM"] = mf({**MFP, "M": 650}, "floating", fval)
    mfo[f"{tag}_fixed_de"] = mf({**MFP, "e0": R(11, 10)}, "fixed", fval)
out["mf"] = mfo

# ------------------------------------------------------------------------------------------------ multipliers
rr_, cr_, er_ = R(1, 10), R(1, 5), R(0)
out["money"] = {"mult": str((1 + cr_) / (rr_ + er_ + cr_)), "M": str(1000 * (1 + cr_) / (rr_ + er_ + cr_)), "D": str(R(1000) / (rr_ + er_ + cr_))}
rr2, cr2, er2 = R(8, 100), R(35, 100), R(2, 100)
out["money2"] = {"mult": str((1 + cr2) / (rr2 + er2 + cr2)), "M": str(R(2500) * (1 + cr2) / (rr2 + er2 + cr2))}
c_, t_, m_ = R(4, 5), R(1, 4), R(1, 10)
k_ = 1 / (1 - c_ * (1 - t_) + m_)
out["fiscal"] = {"k": str(k_), "kT": str(-c_ * k_), "kB": str((1 - c_) * k_), "Y0": str(600 * k_), "dY": str(100 * k_), "dBudget": str(t_ * 100 * k_ - 100)}
c2, t2, m2 = R(9, 10), R(3, 10), R(1, 5)
k2 = 1 / (1 - c2 * (1 - t2) + m2)
out["fiscal2"] = {"k": str(k2), "kT": str(-c2 * k2), "kB": str((1 - c2) * k2)}

# ------------------------------------------------------------------------------------------------ Phillips (synthetic)
rng = np.random.default_rng(20261027)
years = np.arange(1990, 2025)
n = len(years)
u = np.empty(n)
u[0] = 5.8
for i in range(1, n):
    u[i] = 5.5 + 0.7 * (u[i - 1] - 5.5) + rng.normal(0, 0.6)
u = np.round(u, 1)
pi = np.empty(n)
pi[0] = 3.0
for i in range(1, n):
    pi[i] = pi[i - 1] + 2.2 - 0.4 * u[i] + rng.normal(0, 0.35)
pi = np.round(pi, 1)
expct = np.round(np.concatenate([[2.6], pi[:-1]]) + rng.normal(0, 0.3, n), 1)
table = ["Year\tinflation\tunemployment\texpected"] + [f"{yr}\t{p:.1f}\t{uu:.1f}\t{e:.1f}" for yr, p, uu, e in zip(years, pi, u, expct)]
out["phillipsTable"] = "\n".join(table)
dpi = np.diff(pi)
X = sm.add_constant(u[1:], prepend=False)
ph = {}
for cov in ("nonrobust", "HC1", "HAC"):
    kw = {}
    if cov == "HAC":
        kw = {"cov_kwds": {"maxlags": int(math.floor(4 * (len(dpi) / 100) ** (2 / 9))), "use_correction": True}}
    r = sm.OLS(dpi, X).fit() if cov == "nonrobust" else sm.OLS(dpi, X).fit(cov_type=cov, use_t=True, **kw)
    b_, a_ = r.params
    V = np.asarray(r.cov_params())
    grad = np.array([a_ / b_**2, -1 / b_])  # order (slope, const)
    nse = float(np.sqrt(grad @ V @ grad))
    ph[cov] = {"alpha": float(a_), "beta": float(b_), "seAlpha": float(r.bse[1]), "seBeta": float(r.bse[0]), "r2": float(r.rsquared), "nairu": float(-a_ / b_), "nairuSe": nse}
# expectations form on the same table
y2 = pi - expct
r2 = sm.OLS(y2, sm.add_constant(u, prepend=False)).fit()
b2, a2 = r2.params
V2 = np.asarray(r2.cov_params())
g2 = np.array([a2 / b2**2, -1 / b2])
ph["expect"] = {"alpha": float(a2), "beta": float(b2), "nairu": float(-a2 / b2), "nairuSe": float(np.sqrt(g2 @ V2 @ g2))}
out["phillips"] = ph

with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    json.dump(out, fh, indent=1, ensure_ascii=False)
print(out["phillipsTable"])
print("wrote", OUT)
