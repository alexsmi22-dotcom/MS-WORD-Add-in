"""
Exact oracle for OLS at high condition numbers (Release E2 fix round): the near-collinear designs on which the first
E2 build's robust Wald F, HC slope SEs and intercept SEs went wrong while still printing.

Each case is p1 ~ N(50, 1), p2 = p1 + eta * noise (eta chosen for a target condition number of the raw design
[p1, p2, 1]), y = 50 + 0.5 p1 + N(0, 1), plus the two tables the adversarial pass found (repro_n12_eps1e-05,
repro_n100_eps0.0001). The data are the doubles written to the JSON (Python's repr round-trips exactly), and every
expected value is computed from those doubles in mpmath at 80 digits: (X'X)^-1 by exact LU, residuals, then the
classical, HC0-HC3, clustered (Stata's G/(G-1)(N-1)/(N-K)) and Newey-West (Bartlett, n/(n-k)) covariances, each SE,
and the Wald F of all slopes under each covariance.

"sens" is the problem's own conditioning: the largest relative change of any SE or F when every data value is moved by
one unit in the last place (random sign), recomputed exactly. No double-precision algorithm can promise to be closer to
the exact value than that; the jest pin uses max(1e-6, 10 * sens).

Run: jurislab-oracle-venv python scripts/econ-ols-nearcollinear-oracle.py  (writes
src/lib/__tests__/fixtures/econ-ols-nearcollinear-oracle.json)
"""
import json, math, os, sys
import numpy as np
import mpmath as mp

mp.mp.dps = 80
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "__tests__", "fixtures", "econ-ols-nearcollinear-oracle.json")

SE_TYPES = ["classical", "hc0", "hc1", "hc2", "hc3", "cluster", "hac"]


def exact(y, cols, constant, clusters, lag):
    n = len(y)
    allc = [list(c) for c in cols] + ([[1.0] * n] if constant else [])
    p = len(allc)
    X = mp.matrix(n, p)
    for j in range(p):
        for i in range(n):
            X[i, j] = mp.mpf(allc[j][i])
    Y = mp.matrix([mp.mpf(v) for v in y])
    XtX = X.T * X
    A = mp.inverse(XtX)
    b = A * (X.T * Y)
    e = Y - X * b
    sse = sum(e[i] ** 2 for i in range(n))
    dfr = n - p
    h = [sum(X[i, a] * sum(A[a, c] * X[i, c] for c in range(p)) for a in range(p)) for i in range(n)]
    out = {"coef": [float(b[j]) for j in range(p)]}
    slopes = list(range(p - 1)) if constant else list(range(p))

    def meat(weights):
        M = mp.matrix(p, p)
        for i in range(n):
            for a in range(p):
                for c in range(p):
                    M[a, c] += weights[i] * X[i, a] * X[i, c]
        return M

    for se in SE_TYPES:
        if se == "classical":
            V = A * (sse / dfr)
            df = dfr
        elif se.startswith("hc"):
            k = int(se[2])
            w = []
            for i in range(n):
                e2 = e[i] ** 2
                w.append(e2 if k == 0 else e2 * n / dfr if k == 1 else e2 / (1 - h[i]) if k == 2 else e2 / (1 - h[i]) ** 2)
            V = A * meat(w) * A
            df = dfr
        elif se == "cluster":
            groups = sorted(set(clusters), key=clusters.index)
            G = len(groups)
            M = mp.matrix(p, p)
            for g in groups:
                u = mp.matrix(p, 1)
                for i in range(n):
                    if clusters[i] == g:
                        for a in range(p):
                            u[a] += e[i] * X[i, a]
                M += u * u.T
            V = A * M * A * (mp.mpf(G) / (G - 1) * mp.mpf(n - 1) / (n - p))
            df = G - 1
        else:
            S = [[e[i] * X[i, a] for a in range(p)] for i in range(n)]
            M = mp.matrix(p, p)
            for i in range(n):
                for a in range(p):
                    for c in range(p):
                        M[a, c] += S[i][a] * S[i][c]
            for l in range(1, lag + 1):
                wl = 1 - mp.mpf(l) / (lag + 1)
                for t in range(l, n):
                    for a in range(p):
                        for c in range(p):
                            M[a, c] += wl * (S[t][a] * S[t - l][c] + S[t - l][a] * S[t][c])
            V = A * M * A * (mp.mpf(n) / dfr)
            df = dfr
        se_v = [float(mp.sqrt(V[j, j])) for j in range(p)]
        q = len(slopes)
        Vs = mp.matrix(q, q)
        bs = mp.matrix(q, 1)
        for a in range(q):
            bs[a] = b[slopes[a]]
            for c in range(q):
                Vs[a, c] = V[slopes[a], slopes[c]]
        F = float((bs.T * mp.inverse(Vs) * bs)[0] / q)
        out[se] = {"se": se_v, "F": F, "df": df}
    return out


def ulp_perturb(vals, rng):
    return [float(np.nextafter(v, math.inf if rng.random() < 0.5 else -math.inf)) for v in vals]


def sensitivity(case, base):
    rng = np.random.default_rng(99)
    worst = 0.0
    for _ in range(2):
        y = ulp_perturb(case["y"], rng)
        cols = [ulp_perturb(c, rng) for c in case["X"]]
        r = exact(y, cols, case["constant"], case["clusters"], case["lag"])
        for se in SE_TYPES:
            for a, b in zip(r[se]["se"], base[se]["se"]):
                worst = max(worst, abs(a - b) / abs(b))
            worst = max(worst, abs(r[se]["F"] - base[se]["F"]) / abs(base[se]["F"]))
        for a, b in zip(r["coef"], base["coef"]):
            worst = max(worst, abs(a - b) / abs(b))
    return worst


def read_repro(path):
    lines = [l.split() for l in open(path) if l.strip()]
    rows = [[float(v) for v in l] for l in lines[1:]]
    return [r[0] for r in rows], [[r[1] for r in rows], [r[2] for r in rows]]


cases = []
rng = np.random.default_rng(20261025)
for n in (12, 60):
    for target in (1e6, 1e8, 1e10):
        # eta for the target: cond([p1, p2, 1]) grows as 1/eta.
        p1 = 50 + rng.standard_normal(n)
        noise = rng.standard_normal(n)
        y = 50 + 0.5 * p1 + rng.standard_normal(n)
        lo, hi = 1e-14, 1.0
        for _ in range(200):
            eta = math.sqrt(lo * hi)
            p2 = p1 + eta * noise
            c = np.linalg.cond(np.column_stack([p1, p2, np.ones(n)]))
            if c > target:
                lo = eta
            else:
                hi = eta
        p2 = p1 + eta * noise
        cond = float(np.linalg.cond(np.column_stack([p1, p2, np.ones(n)])))
        cases.append({"name": f"n{n} cond {cond:.1e}", "cond": cond, "y": [float(v) for v in y], "X": [[float(v) for v in p1], [float(v) for v in p2]],
                      "names": ["p1", "p2"], "constant": True, "clusters": [str(i // 3) for i in range(n)], "lag": 2})
# No constant at a high condition number.
n = 40
p1 = 50 + rng.standard_normal(n)
p2 = p1 + 1e-7 * rng.standard_normal(n)
y = 0.5 * p1 + rng.standard_normal(n)
cases.append({"name": "no constant n40", "cond": float(np.linalg.cond(np.column_stack([p1, p2]))), "y": [float(v) for v in y], "X": [[float(v) for v in p1], [float(v) for v in p2]],
              "names": ["p1", "p2"], "constant": False, "clusters": [str(i // 4) for i in range(n)], "lag": 3})
ADV = sys.argv[1] if len(sys.argv) > 1 else None
if ADV:
    for f in ("repro_n12_eps1e-05.txt", "repro_n100_eps0.0001.txt"):
        y, X = read_repro(os.path.join(ADV, f))
        n = len(y)
        cases.append({"name": f"adversarial {f[6:-4]}", "cond": float(np.linalg.cond(np.column_stack(X + [np.ones(n)]))), "y": y, "X": X, "names": ["p1", "p2"],
                      "constant": True, "clusters": [str(i // 3) for i in range(n)], "lag": 2})

for c in cases:
    r = exact(c["y"], c["X"], c["constant"], c["clusters"], c["lag"])
    c["expected"] = r
    c["sens"] = sensitivity(c, r)
    print(c["name"], "cond %.2e" % c["cond"], "sens %.2e" % c["sens"], "F hc1 %.10g" % r["hc1"]["F"], file=sys.stderr)

json.dump({"meta": {"mpmath_dps": 80, "generator": "scripts/econ-ols-nearcollinear-oracle.py", "seed": 20261025}, "cases": cases}, open(OUT, "w"), indent=0)
