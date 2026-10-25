"""
Oracle for the Release E5a calculators: ineq-gini, conc-hhi, io-leontief, fin-currency.

Every value is computed here independently from the textbook definitions, in exact fractions (fractions.Fraction,
sympy for matrix inverses) and mpmath at 50 digits for the logarithmic measures:
  - Gini: G = sum_i sum_j w_i w_j |x_i - x_j| / (2 W^2 mu), the double sum done literally (Sen 1973; Cowell 2011).
  - Theil T = GE(1), Theil L = GE(0) (Theil 1967; Shorrocks 1980); Atkinson (1970) A(eps).
  - Quantiles: Hyndman & Fan (1996) definition 1 on the weighted empirical distribution.
  - Lorenz curve: straight segments between (cum. population share, cum. income share); Palma = (1 - L(0.9)) / L(0.4).
  - HHI = sum s_i^2 (percent shares), dHHI = (sum s_m)^2 - sum s_m^2; 2023 Merger Guidelines Guideline 1 thresholds
    (HHI > 1,800 and dHHI > 100; merged share > 30% and dHHI > 100), strict inequalities.
  - Leontief: L = (I - A)^-1 by sympy Matrix.inv() in exact rationals; Rasmussen indices n*sum/total; Ghosh
    B = diag(x)^-1 Z.
  - Currency: cross rate rate_to / rate_from, conversion rounded half away from zero to the ISO 4217 minor unit.
All data are invented for this script (no textbook tables).

Run: jurislab-oracle-venv python scripts/econ-e5a-oracle.py  (writes src/lib/__tests__/fixtures/econ-e5a-oracle.json)
"""
import json, os
from fractions import Fraction as F
import mpmath as mp
import numpy as np
import sympy as sp

mp.mp.dps = 50
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "__tests__", "fixtures", "econ-e5a-oracle.json")


def fr(s):
    return F(str(s))


def fstr(q):
    return f"{q.numerator}/{q.denominator}"


# ------------------------------------------------------------------------------------------------------- inequality
def ineq(xs, ws, eps_list):
    x = [fr(v) for v in xs]
    w = [fr(v) for v in ws]
    n = len(x)
    W = sum(w)
    T = sum(wi * xi for wi, xi in zip(w, x))
    mu = T / W
    D = F(0)
    for i in range(n):
        for j in range(n):
            D += w[i] * w[j] * abs(x[i] - x[j])
    G = D / (2 * W * W * mu)
    out = {"gini": fstr(G), "gini_float": float(G), "mean": float(mu)}
    zeros = sum(1 for v in x if v == 0)
    neg = sum(1 for v in x if v < 0)
    m = mp.mpf(mu.numerator) / mu.denominator
    if neg == 0:
        t = mp.mpf(0)
        for xi, wi in zip(x, w):
            if xi > 0:
                r = (mp.mpf(xi.numerator) / xi.denominator) / m
                t += (mp.mpf(wi.numerator) / wi.denominator) * r * mp.log(r)
        out["theilT"] = float(t / (mp.mpf(W.numerator) / W.denominator))
        if zeros == 0:
            l = mp.mpf(0)
            for xi, wi in zip(x, w):
                l += (mp.mpf(wi.numerator) / wi.denominator) * mp.log(m / (mp.mpf(xi.numerator) / xi.denominator))
            out["theilL"] = float(l / (mp.mpf(W.numerator) / W.denominator))
    atk = {}
    Wm = mp.mpf(W.numerator) / W.denominator
    for e in eps_list:
        if neg > 0 or (e >= 1 and zeros > 0):
            continue
        em = mp.mpf(str(e))
        if e == 1:
            s = mp.mpf(0)
            for xi, wi in zip(x, w):
                s += (mp.mpf(wi.numerator) / wi.denominator) * mp.log(mp.mpf(xi.numerator) / xi.denominator)
            atk[str(e)] = float(1 - mp.exp(s / Wm) / m)
        else:
            s = mp.mpf(0)
            for xi, wi in zip(x, w):
                if xi == 0:
                    continue
                s += (mp.mpf(wi.numerator) / wi.denominator) * ((mp.mpf(xi.numerator) / xi.denominator) / m) ** (1 - em)
            atk[str(e)] = float(1 - (s / Wm) ** (1 / (1 - em)))
    out["atkinson"] = atk
    # sorted, Lorenz, quantiles
    order = sorted(range(n), key=lambda i: x[i])
    cum = F(0)
    cs = F(0)
    pts = [(F(0), F(0))]
    xs_sorted = []
    cums = []
    for i in order:
        cum += w[i]
        cs += w[i] * x[i]
        pts.append((cum / W, cs / T))
        xs_sorted.append(x[i])
        cums.append(cum)

    def L(p):
        for k in range(1, len(pts)):
            if pts[k][0] >= p:
                a, b = pts[k - 1], pts[k]
                if b[0] == a[0]:
                    return b[1]
                return a[1] + (b[1] - a[1]) * (p - a[0]) / (b[0] - a[0])
        return F(1)

    def Q(p):
        for xi, c in zip(xs_sorted, cums):
            if c >= p * W:
                return xi
        return xs_sorted[-1]

    b40 = L(F(2, 5))
    t10 = 1 - L(F(9, 10))
    out["bottom40"] = float(b40)
    out["top10"] = float(t10)
    out["lorenz_deciles"] = [float(L(F(k, 10))) for k in range(11)]
    if b40 > 0:
        out["palma"] = float(t10 / b40)
    p10, p90 = Q(F(1, 10)), Q(F(9, 10))
    out["p10"] = float(p10)
    out["p90"] = float(p90)
    if p10 > 0:
        out["p90p10"] = float(p90 / p10)
    if n >= 2:
        out["gini_nn1"] = float(G * n / (n - 1))
    return out


DEFAULT_INCOMES = [8400, 12600, 15100, 17800, 19950, 22300, 24800, 26500, 29100, 31750,
                   34200, 37900, 41500, 45800, 51200, 57600, 66300, 78900, 97500, 164000]

ineq_cases = [
    {"name": "default 20 incomes", "x": DEFAULT_INCOMES, "w": [1] * 20, "grouped": False, "eps": [0.5, 1, 2]},
    {"name": "zeros", "x": [0, 0, 5, 10, 20, 65], "w": [1] * 6, "grouped": False, "eps": [0.5, 1, 2]},
    {"name": "grouped means and counts", "x": [5000, 15000, 30000, 60000, 150000], "w": [120, 300, 250, 100, 30],
     "grouped": True, "eps": [0.5, 1, 2]},
    {"name": "awkward: ties, 10^12 scale, fractional weights, user eps 3.5",
     "x": ["1e12", "1e12", "3.5e12", "0.25e12", "7e12", "0.25e12"], "w": ["2.5", "1", "0.75", "4", "0.125", "1"],
     "grouped": True, "eps": [0.5, 1, 2, 3.5]},
    {"name": "negative income", "x": [-50, 100, 200, 300, 450], "w": [1] * 5, "grouped": False, "eps": [0.5, 1, 2]},
    {"name": "two equal halves", "x": [1, 3], "w": [1, 1], "grouped": False, "eps": [0.5, 1, 2]},
]
for c in ineq_cases:
    c["expect"] = ineq([fr(v) if isinstance(v, str) else v for v in c["x"]], c["w"], c["eps"])
    c["x"] = [str(v) for v in c["x"]]
    c["w"] = [str(v) for v in c["w"]]


# ------------------------------------------------------------------------------------------------------- HHI
def pts_text(q):
    """Exact when the value terminates within 2 decimals, else rounded half away from zero to 2; grouped thousands."""
    q = F(q)
    for dp in range(3):
        if (q * 10 ** dp).denominator == 1:
            break
    else:
        dp = None
    if dp is None:
        dp = 2
        u = abs(q) * 100
        k = u.numerator // u.denominator
        if 2 * (u - k) >= 1:
            k += 1
    else:
        k = abs(q * 10 ** dp).numerator
    s = str(k).rjust(dp + 1, "0")
    i, f = (s[: len(s) - dp], s[len(s) - dp:]) if dp else (s, "")
    i = f"{int(i):,}"
    return ("−" if q < 0 else "") + i + ("." + f if dp else "")


def hhi_case(name, firms, units, merging):
    vals = [fr(v) for _, v in firms]
    if units == "sales":
        tot = sum(vals)
        shares = [v * 100 / tot for v in vals]
    elif units == "fraction":
        shares = [v * 100 for v in vals]
    else:
        shares = vals
    s = sum(shares)
    fringe = 100 - s if s < F(995, 10) else F(0)
    hhi = sum(v * v for v in shares)
    hhi_hi = hhi + fringe * fringe
    idx = [i for i, (n, _) in enumerate(firms) if n in merging]
    ms = sum(shares[i] for i in idx)
    delta = ms * ms - sum(shares[i] ** 2 for i in idx)
    post, post_hi = hhi + delta, hhi_hi + delta

    def tri(lo, hi):
        return "yes" if lo and hi else ("no" if not lo and not hi else "depends")

    sig = delta > 100
    return {
        "name": name,
        "table": "Firm\tShare\n" + "\n".join(f"{n}\t{v}" for n, v in firms),
        "units": units,
        "merging": "\n".join(merging),
        "hhi": pts_text(hhi), "hhi_hi": pts_text(hhi_hi), "delta": pts_text(delta),
        "post": pts_text(post), "post_hi": pts_text(post_hi), "merged_share": pts_text(ms),
        "fringe": pts_text(fringe),
        "highly": tri(post > 1800, post_hi > 1800),
        "pres_hhi": tri(post > 1800 and sig, post_hi > 1800 and sig),
        "pres_share": bool(ms > 30 and sig),
        "sig": bool(sig),
    }


hhi_cases = [
    hhi_case("default", [("Alder", "28"), ("Birch", "22"), ("Cedar", "18"), ("Dogwood", "14"), ("Elm", "10"), ("Fir", "8")],
             "percent", ["Cedar", "Elm"]),
    hhi_case("fraction with a fringe that straddles 1,800", [("North", "0.30"), ("South", "0.20"), ("East", "0.10"), ("West", "0.10")],
             "fraction", ["East", "West"]),
    hhi_case("sales, share presumption", [("Ash", "500"), ("Beech", "300"), ("Holly", "150"), ("Ivy", "50")], "sales", ["Beech", "Ivy"]),
    hhi_case("awkward: exactly 1,800 and exactly 100 (no presumption)",
             [("A1", "30"), ("A2", "20"), ("A3", "15"), ("M1", "10"), ("M2", "5")] + [(f"F{k}", "2.5") for k in range(1, 9)],
             "percent", ["M1", "M2"]),
    hhi_case("three-firm merger, thirds of a percent", [("P", "33.3"), ("Q", "33.3"), ("R", "33.4")], "percent", ["P", "Q", "R"]),
]


# ------------------------------------------------------------------------------------------------------- Leontief
def io_case(name, A_rows, f=None, e=None, names=None, Z=None, x=None):
    if Z is not None:
        Zm = sp.Matrix([[sp.Rational(str(v)) for v in r] for r in Z])
        xv = [sp.Rational(str(v)) for v in x]
        n = len(xv)
        A = sp.Matrix(n, n, lambda i, j: Zm[i, j] / xv[j])
    else:
        A = sp.Matrix([[sp.Rational(str(v)) for v in r] for r in A_rows])
        n = A.shape[0]
    L = (sp.eye(n) - A).inv()
    out = {"name": name, "n": n, "L": [[str(L[i, j]) for j in range(n)] for i in range(n)],
           "Lf": [[float(L[i, j]) for j in range(n)] for i in range(n)]}
    colsum = [sum(L[i, j] for i in range(n)) for j in range(n)]
    rowsum = [sum(L[i, j] for j in range(n)) for i in range(n)]
    tot = sum(colsum)
    out["output_mult"] = [float(v) for v in colsum]
    out["bl"] = [float(n * v / tot) for v in colsum]
    out["fl_rasmussen"] = [float(n * v / tot) for v in rowsum]
    if Z is not None:
        B = sp.Matrix(n, n, lambda i, j: Zm[i, j] / xv[i])
        G = (sp.eye(n) - B).inv()
        gr = [sum(G[i, j] for j in range(n)) for i in range(n)]
        gt = sum(gr)
        out["fl_ghosh"] = [float(n * v / gt) for v in gr]
        fimp = [xv[i] - sum(Zm[i, j] for j in range(n)) for i in range(n)]
        out["f_implied"] = [float(v) for v in fimp]
        out["x_from_f"] = [float(v) for v in (L * sp.Matrix(fimp))]
    if f is not None:
        fv = sp.Matrix([sp.Rational(str(v)) for v in f])
        out["x"] = [float(v) for v in (L * fv)]
    if e is not None:
        ev = [sp.Rational(str(v)) for v in e]
        eff = [sum(ev[i] * L[i, j] for i in range(n)) for j in range(n)]
        out["emp_effect"] = [float(v) for v in eff]
        out["emp_type1"] = [float(eff[j] / ev[j]) if ev[j] != 0 else None for j in range(n)]
    out["rho"] = float(max(abs(np.linalg.eigvals(np.array(A.evalf(30).tolist(), dtype=float)))))
    return out


def nine_by_nine():
    """A 9-sector A (above the exact limit) built from a fixed LCG, column sums below 0.9."""
    st = [12345]

    def u():
        st[0] = (st[0] * 1103515245 + 12345) % 2147483648
        return st[0] % 1000

    rows = [[F(u(), 10000) for _ in range(9)] for _ in range(9)]  # entries 0 to 0.0999
    return [[str(float(v)) for v in r] for r in rows]


NINE = nine_by_nine()
io_cases = [
    io_case("default 3 sectors", [["0.15", "0.25", "0.05"], ["0.20", "0.05", "0.40"], ["0.30", "0.25", "0.05"]],
            f=[100, 200, 300], e=["0.8", "0.5", "1.2"]),
    io_case("productive with a column sum above 1", [["0", "1.5"], ["0.1", "0"]], f=[10, 10]),
    io_case("transactions table", None, Z=[[20, 50, 10], [30, 10, 60], [10, 40, 20]], x=[200, 250, 180], e=["2", "0", "1.5"]),
    io_case("awkward: 9 sectors (float path)", NINE, f=[1] * 9),
]
io_cases[0]["matrix"] = "Sector\tFarming\tManufacturing\tServices\nFarming\t0.15\t0.25\t0.05\nManufacturing\t0.20\t0.05\t0.40\nServices\t0.30\t0.25\t0.05"
io_cases[1]["matrix"] = "\tP\tQ\nP\t0\t1.5\nQ\t0.1\t0"
io_cases[2]["matrix"] = "\tAg\tInd\tSvc\nAg\t20\t50\t10\nInd\t30\t10\t60\nSvc\t10\t40\t20"
io_cases[3]["matrix"] = "\n".join(["\t" + "\t".join(f"S{j + 1}" for j in range(9))] + [f"S{i + 1}\t" + "\t".join(r) for i, r in enumerate(NINE)])


# ------------------------------------------------------------------------------------------------------- currency
MINOR = {"USD": 2, "EUR": 2, "GBP": 2, "JPY": 0, "KWD": 3, "CLP": 0, "KRW": 0, "BHD": 3, "CLF": 4, "XAU": None}


def round_half_away(q, d):
    u = abs(q) * 10 ** d
    k = u.numerator // u.denominator
    if 2 * (u - k) >= 1:
        k += 1
    return -k if q < 0 and k else k


def units_text(k, d):
    s = str(abs(k)).rjust(d + 1, "0")
    i, f = (s[: len(s) - d], s[len(s) - d:]) if d else (s, "")
    return ("−" if k < 0 else "") + f"{int(i):,}" + ("." + f if d else "")


def fx_case(name, base, rates, amounts, target):
    R = {base: F(1)}
    for c, r in rates:
        R[c] = fr(r)
    conv = []
    for a, c in amounts:
        q = fr(a) * R[target] / R[c]
        d = MINOR[target] if MINOR[target] is not None else 6
        conv.append(units_text(round_half_away(q, d), d) + " " + target)
    return {"name": name, "base": base, "rates": "\n".join(f"{c} {r}" for c, r in rates),
            "amounts": "\n".join(f"{a} {c}" for a, c in amounts), "target": target, "converted": conv}


fx_cases = [
    fx_case("default", "USD", [("EUR", "0.9200"), ("GBP", "0.7850"), ("JPY", "151.25"), ("KWD", "0.3071"), ("CLP", "945.50")],
            [("1250.00", "EUR"), ("980.50", "GBP"), ("150000", "JPY"), ("420.125", "KWD")], "EUR"),
    fx_case("zero-decimal target, halves away from zero", "USD", [("KRW", "1000")], [("0.0025", "USD"), ("-0.0025", "USD"), ("0.0015", "USD"), ("12.3456", "USD")], "KRW"),
    fx_case("three-decimal target", "USD", [("BHD", "0.5")], [("0.001", "USD"), ("10.003", "USD"), ("-0.001", "USD")], "BHD"),
    fx_case("awkward: four-decimal CLF via CLP cross rate", "USD", [("CLP", "945.5"), ("CLF", "0.0265")], [("1000000", "CLP"), ("33333", "CLP")], "CLF"),
]

json.dump({"ineq": ineq_cases, "hhi": hhi_cases, "io": io_cases, "fx": fx_cases}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("wrote", OUT)
