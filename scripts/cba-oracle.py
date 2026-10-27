"""Oracle for release F2 item #18 (CBA, Pigouvian tax) and quick win 12 (CIP / UIP / PPP): src/lib/cbaCalcs.ts.

Run:  ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/cba-oracle.py
Writes src/lib/__tests__/fixtures/cba-oracle.json.

Sources:
  CBA        numpy_financial 1.1: npf.npv(rate, flows) (first flow at t = 0, undiscounted) on the benefits, the costs
             and the net flows, zero-filled between listed years; npf.irr on the net flows; and numpy.roots on
             sum c_t v^t (v = 1/(1 + r)) for every real root with r in (-0.99, 100], as portcorp-oracle.py does.
  Pigou      sympy: the market and social optima by solving demand = MPC and demand = MSC; DWL by integrating
             (MSC - demand) from Q_s to Q_m.
  CIP        the covered-interest-parity identity F = S (1 + i_d tau_d)/(1 + i_f tau_f) for money-market (simple)
             deposits and F = S exp((i_d - i_f) tau) with continuous compounding (Hull, Options, Futures, and Other
             Derivatives, ch. 5, forward on a foreign currency, F0 = S0 e^((r - r_f) T)); written here independently,
             at 30-digit sympy precision.
  CIP (QL)   QuantLib 1.44 InterestRate(r, Actual360 | Actual365Fixed, Simple).compoundFactor over the tenor's days:
             the growth factors and F, a library check of the simple case.
  UIP, PPP   E[S_T] = S ((1 + i_d)/(1 + i_f))^T and S_T = S0 ((1 + pi)/(1 + pi*))^T, the PPP rate P/P*.
"""
import json
import os

import numpy as np
import numpy_financial as npf
import sympy as sp

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "lib", "__tests__", "fixtures", "cba-oracle.json")
out = {}


def all_irr(flows):
    # roots in v of sum c_t v^t; numpy.roots wants the highest power first
    roots = np.roots(list(reversed(flows)))
    rs = sorted(1 / v.real - 1 for v in roots if abs(v.imag) < 1e-9 and v.real > 0 and -0.99 < 1 / v.real - 1 <= 100)
    return rs


def cba(table, rate, factors=None, base=None):
    years = [row[0] for row in table]
    base = years[0] if base is None else base
    S = (len(table[0]) - 1) // 2
    T = years[-1] - base
    fac = factors or [1.0] * (2 * S)
    res = []
    for k in range(S):
        b = [0.0] * (T + 1)
        c = [0.0] * (T + 1)
        b0 = [0.0] * (T + 1)
        c0 = [0.0] * (T + 1)
        for row in table:
            t = row[0] - base
            b0[t] = row[1 + 2 * k]
            c0[t] = row[2 + 2 * k]
            b[t] = b0[t] * fac[2 * k]
            c[t] = c0[t] * fac[2 * k + 1]
        net = [x - y for x, y in zip(b, c)]
        pvb = npf.npv(rate, b)
        pvc = npf.npv(rate, c)
        res.append({"pvB": pvb, "pvC": pvc, "npv": npf.npv(rate, net), "bcr": pvb / pvc if pvc > 0 else None, "irr": all_irr(net),
                    "irrNpf": float(npf.irr(net)) if np.isfinite(npf.irr(net)) else None, "npvFinancial": npf.npv(rate, [x - y for x, y in zip(b0, c0)]),
                    "sens": [npf.npv(g / 100, net) for g in range(1, 8)]})
    return res


T0 = [[2026, 0, 1000, 0, 1000, 0, 1200]] + [[y, 180, 50, 130, 50, 230, 60] for y in range(2027, 2037)]
out["cba_default"] = cba(T0, 0.04)
out["cba_factors"] = cba(T0, 0.04, [1, 0.8] * 3)
# gaps between years, a base year before the first row, two IRRs (a later outflow)
T1 = [[2025, 0, 500], [2027, 400, 0], [2030, 600, 0], [2032, 0, 450]]
out["cba_gaps"] = cba(T1, 0.06, base=2024)
T2 = [[0, 0, 100], [1, 230, 0], [2, 0, 132]]
out["cba_tworoots"] = cba(T2, 0.15)

# Pigou
Q = sp.symbols("Q", real=True)


def pigou(a, b, c, d, e0, e1):
    a, b, c, d, e0, e1 = map(sp.nsimplify, (a, b, c, d, e0, e1))
    mb = a - b * Q
    mpc = c + d * Q
    mec = e0 + e1 * Q
    qm = sp.solve(sp.Eq(mb, mpc), Q)[0]
    qs = sp.solve(sp.Eq(mb, mpc + mec), Q)[0]
    dwl = sp.integrate(mpc + mec - mb, (Q, qs, qm))
    return {"qm": float(qm), "pm": float(mb.subs(Q, qm)), "qs": float(qs), "ps": float(mb.subs(Q, qs)), "tax": float(mec.subs(Q, qs)),
            "dwl": float(abs(dwl)), "extM": float(sp.integrate(mec, (Q, 0, qm))), "extS": float(sp.integrate(mec, (Q, 0, qs)))}


out["pigou"] = [pigou(100, 1, 10, 0.5, 6, 0.2), pigou(80, 2, 20, 1, 5, 0), pigou(50, 1, 5, 1, -4, -0.1)]

# CIP
def cip(S, id_, if_, days, bd, bf, comp):
    S, id_, if_ = map(sp.nsimplify, (S, id_, if_))
    td = sp.Rational(days, bd)
    tf = sp.Rational(days, bf)
    if comp == "simple":
        F = S * (1 + id_ / 100 * td) / (1 + if_ / 100 * tf)
    else:
        F = S * sp.exp(id_ / 100 * td - if_ / 100 * tf)
    return float(sp.N(F, 30))


out["cip"] = [
    {"in": [1.25, 5, 3, 182, 360, 360, "simple"], "F": cip(1.25, 5, 3, 182, 360, 360, "simple")},
    {"in": [1.25, 5, 3, 182, 360, 360, "continuous"], "F": cip(1.25, 5, 3, 182, 360, 360, "continuous")},
    {"in": [1.2700, 4.5, 3.75, 91, 360, 365, "simple"], "F": cip(1.27, 4.5, 3.75, 91, 360, 365, "simple")},
    {"in": [150.25, 0.1, 5.25, 365, 360, 360, "simple"], "F": cip(150.25, 0.1, 5.25, 365, 360, 360, "simple")},
]
# QuantLib 1.44 cross-check of the simple money-market growth factors (Actual360 / Actual365Fixed, Simple compounding)
import QuantLib as ql
d0 = ql.Date(2, 1, 2026)
def ql_factor(rate_pct, days, basis):
    dc = ql.Actual360() if basis == 360 else ql.Actual365Fixed()
    return ql.InterestRate(rate_pct / 100, dc, ql.Simple, ql.Annual).compoundFactor(d0, d0 + days)
out["cipQuantLib"] = []
for S_, id_, if_, days, bd, bf in ((1.25, 5, 3, 182, 360, 360), (1.27, 4.5, 3.75, 91, 360, 365), (150.25, 0.1, 5.25, 365, 360, 360)):
    gd_, gf_ = ql_factor(id_, days, bd), ql_factor(if_, days, bf)
    out["cipQuantLib"].append({"in": [S_, id_, if_, days, bd, bf], "growD": gd_, "growF": gf_, "F": S_ * gd_ / gf_})
# covered arbitrage profit on 1,000,000 domestic at the default quote 1.265 (simple): (Fq/S)(1 + if tau) - (1 + id tau)
S, Fq = sp.Rational(5, 4), sp.Rational(1265, 1000)
gd = 1 + sp.Rational(5, 100) * sp.Rational(182, 360)
gf = 1 + sp.Rational(3, 100) * sp.Rational(182, 360)
out["cipProfit"] = float(1_000_000 * (Fq / S * gf - gd))

# UIP / PPP
out["uip"] = {"ES": 1.25 * (1.05 / 1.03), "dep": 1.05 / 1.03 - 1, "excess": (1.24 / 1.25) * 1.03 / 1.05 - 1, "ES3": 1.25 * (1.05 / 1.03) ** 3}
out["ppp"] = {"sppp": 5.5 / 4.8, "q": 1.25 * 4.8 / 5.5, "mis": 1.25 / (5.5 / 4.8) - 1, "ST": 1.25 * (1.04 / 1.02) ** 5, "perYear": 1.04 / 1.02 - 1}

with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
    json.dump(out, fh, indent=1)
print(json.dumps(out)[:2500])
