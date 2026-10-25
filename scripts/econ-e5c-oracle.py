"""
Oracle for the Release E5c calculators (game-nash, macro-solow, macro-islm, macro-taylor).

game-nash: an independent support enumeration written here with Python's fractions.Fraction (nashpy is not
installed). For every pair of supports of equal size it solves the two indifference systems by exact Gaussian
elimination, keeps strictly positive solutions and checks every pure deviation. Games are written for this script
(prisoner's dilemma shape, matching pennies shape, battle-of-the-sexes shape, an asymmetric 3 x 3, a zero-sum 3 x 3,
a degenerate 3 x 2, a seeded random-integer 8 x 8). Zero-sum values are cross-checked with scipy.optimize.linprog.

macro-solow: closed forms in mpmath at 50 digits (k* = (s/D)^(1/(1-alpha)), D = (1+n)(1+g) - (1-delta); golden rule;
phi'(k*) = (alpha*D + 1 - delta)/((1+n)(1+g)); half-life ln 2/(-ln phi')), and the discrete path iterated in mpmath.

macro-islm and macro-taylor: sympy Rational solutions of the linear IS-LM system and the Taylor (1993) rule.

Run: C:/Users/AlexanderSmith/jurislab-oracle-venv/Scripts/python.exe scripts/econ-e5c-oracle.py
     (writes src/lib/__tests__/fixtures/econ-e5c-oracle.json)
"""
import json
import os
import random
from fractions import Fraction as F
from itertools import combinations

import mpmath as mp
import sympy as sp
from scipy.optimize import linprog

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "__tests__", "fixtures", "econ-e5c-oracle.json")


def fs(x):
    x = F(x)
    return f"{x.numerator}/{x.denominator}" if x.denominator != 1 else str(x.numerator)


# ------------------------------------------------------------------------------------------------- game-nash
def gauss(M, b):
    n = len(M)
    a = [list(map(F, row)) + [F(b[i])] for i, row in enumerate(M)]
    for c in range(n):
        piv = next((r for r in range(c, n) if a[r][c] != 0), None)
        if piv is None:
            return None
        a[c], a[piv] = a[piv], a[c]
        p = a[c][c]
        a[c] = [v / p for v in a[c]]
        for r in range(n):
            if r != c and a[r][c] != 0:
                f = a[r][c]
                a[r] = [v - f * w for v, w in zip(a[r], a[c])]
    return [a[i][n] for i in range(n)]


def nash_all(A, B):
    m, n = len(A), len(A[0])
    found = []
    for k in range(1, min(m, n) + 1):
        for I in combinations(range(m), k):
            for J in combinations(range(n), k):
                # column mix y on J makes row player indifferent on I
                My = [[A[i][j] for j in J] + [-1] for i in I] + [[1] * k + [0]]
                sy = gauss(My, [0] * k + [1])
                Mx = [[B[i][j] for i in I] + [-1] for j in J] + [[1] * k + [0]]
                sx = gauss(Mx, [0] * k + [1])
                if sy is None or sx is None:
                    continue
                if any(v <= 0 for v in sy[:k]) or any(v <= 0 for v in sx[:k]):
                    continue
                x = [F(0)] * m
                y = [F(0)] * n
                for t, i in enumerate(I):
                    x[i] = sx[t]
                for t, j in enumerate(J):
                    y[j] = sy[t]
                ra = [sum(A[i][j] * y[j] for j in range(n)) for i in range(m)]
                cb = [sum(B[i][j] * x[i] for i in range(m)) for j in range(n)]
                u1 = sum(x[i] * ra[i] for i in range(m))
                u2 = sum(y[j] * cb[j] for j in range(n))
                if max(ra) > u1 or max(cb) > u2:
                    continue
                if any(e["x"] == x and e["y"] == y for e in found):
                    continue
                found.append({"x": x, "y": y, "u1": u1, "u2": u2})
    return found


def lp_value(A):
    """max v s.t. x^T A >= v, sum x = 1 (float, scipy)."""
    m, n = len(A), len(A[0])
    c = [0.0] * m + [-1.0]
    A_ub = [[-float(A[i][j]) for i in range(m)] + [1.0] for j in range(n)]
    b_ub = [0.0] * n
    A_eq = [[1.0] * m + [0.0]]
    res = linprog(c, A_ub=A_ub, b_ub=b_ub, A_eq=A_eq, b_eq=[1.0], bounds=[(0, None)] * m + [(None, None)], method="highs")
    return -res.fun


def table(rows, cols, M):
    lines = ["Row\\Col\t" + "\t".join(cols)]
    for r, row in zip(rows, M):
        lines.append(r + "\t" + "\t".join(cell for cell in row))
    return "\n".join(lines)


def game_case(name, rows, cols, Atxt, Btxt, note=""):
    A = [[F(c) for c in r] for r in Atxt]
    B = [[F(c) for c in r] for r in Btxt]
    eqs = nash_all(A, B)
    zs = all(A[i][j] + B[i][j] == A[0][0] + B[0][0] for i in range(len(A)) for j in range(len(A[0])))
    case = {
        "name": name,
        "note": note,
        "rowNames": rows,
        "colNames": cols,
        "row": table(rows, cols, Atxt),
        "col": table(rows, cols, Btxt),
        "equilibria": [{"x": [fs(v) for v in e["x"]], "y": [fs(v) for v in e["y"]], "u1": fs(e["u1"]), "u2": fs(e["u2"])} for e in eqs],
        "constantSum": zs,
    }
    if zs:
        case["lpValue"] = lp_value(A)
    return case


def games():
    out = []
    out.append(game_case("prisoners-dilemma shape", ["Quiet", "Confess"], ["Quiet", "Confess"], [["3", "0"], ["5", "1"]], [["3", "5"], ["0", "1"]]))
    out.append(game_case("matching-pennies shape", ["Heads", "Tails"], ["Heads", "Tails"], [["1", "-1"], ["-1", "1"]], [["-1", "1"], ["1", "-1"]]))
    out.append(game_case("battle-of-the-sexes shape", ["Concert", "Stadium"], ["Concert", "Stadium"], [["3", "0"], ["0", "2"]], [["2", "0"], ["0", "3"]]))
    out.append(game_case(
        "asymmetric 3x3 with a fully mixed equilibrium",
        ["Up", "Middle", "Down"], ["Left", "Centre", "Right"],
        [["0", "-1", "3"], ["2", "0", "-1"], ["-1", "1", "0"]],
        [["1", "3", "-2"], ["-1", "0", "2"], ["2", "-1", "0"]],
    ))
    out.append(game_case(
        "zero-sum 3x3 (awkward value)",
        ["R1", "R2", "R3"], ["C1", "C2", "C3"],
        [["0", "-2", "3"], ["3", "0", "-4"], ["-1", "5", "0"]],
        [["0", "2", "-3"], ["-3", "0", "4"], ["1", "-5", "0"]],
    ))
    out.append(game_case(
        "decimals and fractions",
        ["A", "B"], ["L", "R"],
        [["0.5", "-1.25"], ["-0.75", "1/3"]],
        [["-0.2", "0.6"], ["1.1", "-0.4"]],
    ))
    out.append(game_case(
        "degenerate 3x2",
        ["Top", "Middle", "Bottom"], ["Left", "Right"],
        [["3", "3"], ["2", "5"], ["0", "6"]],
        [["3", "3"], ["2", "6"], ["3", "1"]],
        "degenerate: against Top the column player has two pure best responses",
    ))
    rnd = random.Random(20261025)
    names_r = [f"r{i + 1}" for i in range(8)]
    names_c = [f"c{j + 1}" for j in range(8)]
    # Redraw until no pure strategy has two pure best responses (ties would make the game degenerate).
    while True:
        A8 = [[rnd.randint(-99, 99) for _ in range(8)] for _ in range(8)]
        B8 = [[rnd.randint(-99, 99) for _ in range(8)] for _ in range(8)]
        col_ties = any(sorted((A8[i][j] for i in range(8)), reverse=True)[0] == sorted((A8[i][j] for i in range(8)), reverse=True)[1] for j in range(8))
        row_ties = any(sorted(B8[i], reverse=True)[0] == sorted(B8[i], reverse=True)[1] for i in range(8))
        if not col_ties and not row_ties:
            break
    A8 = [[str(v) for v in r] for r in A8]
    B8 = [[str(v) for v in r] for r in B8]
    # Strategy names must not read as numbers, so they carry a letter (r1, c1). This first draw has no pure ties but is
    # degenerate at a mixed equilibrium (a support of 2 with 3 best responses) and has an even number of equilibria.
    out.append(game_case("random-integer 8x8, degenerate at a mixed strategy (seed 20261025)", names_r, names_c, A8, B8))
    # Then redraw until the game is nondegenerate by the same tests the calculator uses.
    while True:
        A8 = [[rnd.randint(-99, 99) for _ in range(8)] for _ in range(8)]
        B8 = [[rnd.randint(-99, 99) for _ in range(8)] for _ in range(8)]
        col_ties = any(sorted((A8[i][j] for i in range(8)), reverse=True)[0] == sorted((A8[i][j] for i in range(8)), reverse=True)[1] for j in range(8))
        row_ties = any(sorted(B8[i], reverse=True)[0] == sorted(B8[i], reverse=True)[1] for i in range(8))
        if col_ties or row_ties:
            continue
        eqs = nash_all([[F(v) for v in r] for r in A8], [[F(v) for v in r] for r in B8])
        bad = False
        for e in eqs:
            ra = [sum(A8[i][j] * e["y"][j] for j in range(8)) for i in range(8)]
            cb = [sum(B8[i][j] * e["x"][i] for i in range(8)) for j in range(8)]
            if sum(v == max(ra) for v in ra) > sum(v > 0 for v in e["y"]) or sum(v == max(cb) for v in cb) > sum(v > 0 for v in e["x"]):
                bad = True
        if not bad and len(eqs) % 2 == 1 and len(eqs) >= 3:
            break
    out.append(game_case("random-integer 8x8, nondegenerate (seed 20261025, redrawn)", names_r, names_c, [[str(v) for v in r] for r in A8], [[str(v) for v in r] for r in B8]))
    return out


# ------------------------------------------------------------------------------------------------- macro-solow
mp.mp.dps = 50


def solow_case(name, alpha, s, n, g, delta, k0, T):
    a, s_, n_, g_, d = (mp.mpf(F(v).numerator) / F(v).denominator for v in (alpha, s, n, g, delta))
    G = (1 + n_) * (1 + g_)
    D = G - (1 - d)
    kstar = (s_ / D) ** (1 / (1 - a))
    kgold = (a / D) ** (1 / (1 - a))
    phi = (a * D + (1 - d)) / G
    lam = -mp.log(phi)
    path = [mp.mpf(F(k0).numerator) / F(k0).denominator]
    for _ in range(T):
        k = path[-1]
        path.append((s_ * k ** a + (1 - d) * k) / G)
    marks = sorted({t for t in [0, 1, 2, 3, 5, 10, 20, 30, 50, 75, 100, T] if t <= T})
    return {
        "name": name,
        "fields": {"alpha": alpha, "s": s, "n": n, "g": g, "delta": delta, "k0": k0, "T": str(T)},
        "D": float(D),
        "kStar": float(kstar),
        "yStar": float(kstar ** a),
        "cStar": float((1 - s_) * kstar ** a),
        "kGold": float(kgold),
        "cGold": float((1 - a) * kgold ** a),
        "phi": float(phi),
        "lambda": float(lam),
        "halfLife": float(mp.log(2) / lam),
        "lambdaC": float((1 - a) * (n_ + g_ + d)),
        "path": {str(t): float(path[t]) for t in marks},
    }


def solow():
    return [
        solow_case("default", "0.3", "0.25", "0.01", "0.02", "0.05", "1", 100),
        solow_case("alpha 1/2 gives a rational k* = 4", "0.5", "0.2", "0", "0", "0.1", "1", 60),
        solow_case("negative population growth, start above k*", "1/3", "0.3", "-0.01", "0.03", "0.02", "40", 400),
        solow_case("full depreciation", "0.4", "0.35", "0.005", "0.015", "1", "0.01", 30),
    ]


# ------------------------------------------------------------------------------------------------- macro-islm
def islm_case(name, f, dG="0", dT="0", dM="0", Yf=None):
    R = lambda v: sp.Rational(v)
    C0, c, T, I0, b, G, M, P, k, h = (R(f[x]) for x in ["C0", "c", "T", "I0", "b", "G", "M", "P", "k", "h"])
    Y, r = sp.symbols("Y r")

    def solve(G_, T_, M_, P_):
        sol = sp.solve([sp.Eq(Y, C0 + c * (Y - T_) + I0 - b * r + G_), sp.Eq(M_ / P_, k * Y - h * r)], [Y, r], dict=True)[0]
        return sol[Y], sol[r]

    Y0, r0 = solve(G, T, M, P)
    Y1, r1 = solve(G + R(dG), T + R(dT), M + R(dM), P)
    Gs, Ts, Ms = sp.symbols("Gs Ts Ms")
    Yg, rg = (sp.solve([sp.Eq(Y, C0 + c * (Y - Ts) + I0 - b * r + Gs), sp.Eq(Ms / P, k * Y - h * r)], [Y, r], dict=True)[0][v] for v in (Y, r))
    case = {
        "name": name,
        "fields": dict(f, dG=dG, dT=dT, dM=dM),
        "Y0": str(Y0), "r0": str(r0), "Y1": str(Y1), "r1": str(r1),
        "dYdG": str(sp.diff(Yg, Gs)), "dYdT": str(sp.diff(Yg, Ts)), "dYdM": str(sp.diff(Yg, Ms)),
        "drdG": str(sp.diff(rg, Gs)), "drdM": str(sp.diff(rg, Ms)),
        "kG": str(1 / (1 - c)),
        "I0v": str(I0 - b * r0),
    }
    if Yf is not None:
        Ps = sp.symbols("Ps", positive=True)
        A_ = C0 - c * T + I0 + G
        D_ = h * (1 - c) + b * k
        sol = sp.solve(sp.Eq((h * A_ + b * M / Ps) / D_, R(Yf)), Ps)
        A1 = C0 - c * (T + R(dT)) + I0 + G + R(dG)
        sol1 = sp.solve(sp.Eq((h * A1 + b * (M + R(dM)) / Ps) / D_, R(Yf)), Ps)
        case["Yf"] = Yf
        case["Pv0"] = str(sol[0])
        case["Pv1"] = str(sol1[0])
    return case


def islm():
    base = {"C0": "200", "c": "0.75", "T": "200", "I0": "300", "b": "25", "G": "250", "M": "600", "P": "1", "k": "0.5", "h": "50"}
    return [
        islm_case("default with dG = 50", base, dG="50"),
        islm_case("awkward fractions, tax cut and money", {"C0": "150", "c": "2/3", "T": "120", "I0": "210", "b": "35", "G": "180", "M": "700", "P": "1.25", "k": "0.4", "h": "45"}, dT="-30", dM="40"),
        islm_case("vertical LM (h = 0)", dict(base, h="0"), dG="50"),
        islm_case("vertical IS (b = 0)", dict(base, b="0"), dM="100"),
        islm_case("vertical AS at Yf = 1900", base, dG="50", Yf="1900"),
    ]


# ------------------------------------------------------------------------------------------------- macro-taylor
def taylor_case(name, rn, pi, pis, gap, api, ay):
    R = sp.Rational
    i = R(rn) + R(pi) + R(api) * (R(pi) - R(pis)) + R(ay) * R(gap)
    return {"name": name, "fields": {"rn": rn, "pi": pi, "piStar": pis, "gap": gap, "aPi": api, "aY": ay}, "i": str(i), "real": str(i - R(pi))}


def taylor():
    return [
        taylor_case("Taylor 1993 coefficients", "2", "3", "2", "1", "0.5", "0.5"),
        taylor_case("deflation and a deep negative gap", "0.5", "-1.2", "2", "-6.5", "0.5", "1"),
        taylor_case("awkward thirds", "1/3", "2.75", "2", "-1/6", "0.7", "0.45"),
    ]


def main():
    data = {"games": games(), "solow": solow(), "islm": islm(), "taylor": taylor()}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")
    for gcase in data["games"]:
        print(gcase["name"], len(gcase["equilibria"]), "equilibria")


if __name__ == "__main__":
    main()
