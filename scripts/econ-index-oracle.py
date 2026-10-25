"""
Exact oracle for the idx-price calculator (Release E3c). Every price and quantity is the decimal string written in
the fixture, read with fractions.Fraction (exact). Laspeyres, Paasche, their chain products and every rebasing are
computed in exact rational arithmetic; Fisher (a square root) and Toernqvist (exp of a share-weighted mean of logs)
are computed from the exact rationals in mpmath at 60 digits. Formulas: ILO/IMF CPI Manual (2004):

  Laspeyres  sum p_t q_s / sum p_s q_s        Paasche  sum p_t q_t / sum p_s q_t
  Fisher     sqrt(L P)                         Toernqvist  exp sum 1/2 (w_s + w_t) ln(p_t / p_s), w = pq / sum pq
  fixed base: period t against the first period; chained: product of the links (t-1, t); rebased: I_t / I_b * 100.

Run: jurislab-oracle-venv python scripts/econ-index-oracle.py
(writes src/lib/__tests__/fixtures/econ-index-oracle.json)
"""
import json
import os
import random
from fractions import Fraction as F

import mpmath as mp

mp.mp.dps = 60
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "__tests__", "fixtures", "econ-index-oracle.json")


def bilateral(P, Q, s, t, f):
    n = len(P[s])
    if f == "laspeyres":
        return sum(P[t][i] * Q[s][i] for i in range(n)) / sum(P[s][i] * Q[s][i] for i in range(n))
    if f == "paasche":
        return sum(P[t][i] * Q[t][i] for i in range(n)) / sum(P[s][i] * Q[t][i] for i in range(n))
    if f == "fisher":
        L = bilateral(P, Q, s, t, "laspeyres")
        Pa = bilateral(P, Q, s, t, "paasche")
        return mp.sqrt(mp.mpf(L.numerator) / L.denominator * mp.mpf(Pa.numerator) / Pa.denominator)
    es = sum(P[s][i] * Q[s][i] for i in range(n))
    et = sum(P[t][i] * Q[t][i] for i in range(n))
    lg = mp.mpf(0)
    for i in range(n):
        w = (P[s][i] * Q[s][i] / es + P[t][i] * Q[t][i] / et) / 2
        if w > 0:
            r = P[t][i] / P[s][i]
            lg += mp.mpf(w.numerator) / w.denominator * mp.log(mp.mpf(r.numerator) / r.denominator)
    return mp.exp(lg)


def series(P, Q, f, chained, base):
    T = len(P)
    out = [F(1)] if f in ("laspeyres", "paasche") else [mp.mpf(1)]
    for t in range(1, T):
        out.append(out[t - 1] * bilateral(P, Q, t - 1, t, f) if chained else bilateral(P, Q, 0, t, f))
    b = out[base]
    return [float(v / b * 100) if isinstance(v, F) else float(v / b * 100) for v in out]


def case(name, header_sep, items, periods, Pstr, Qstr, header_style="P"):
    T = len(periods)
    P = [[F(Pstr[t][i].replace(",", ".")) for i in range(len(items))] for t in range(T)]
    Q = [[F(Qstr[t][i].replace(",", ".")) for i in range(len(items))] for t in range(T)]
    if header_style == "P":
        head = ["Item"] + [h for per in periods for h in (f"P{per}", f"Q{per}")]
    else:
        head = ["Item"] + [h for per in periods for h in (f"Price {per}", f"Qty {per}")]
    lines = [header_sep.join(head)]
    for i, it in enumerate(items):
        lines.append(header_sep.join([it] + [c for t in range(T) for c in (Pstr[t][i], Qstr[t][i])]))
    expect = []
    for chained in (False, True):
        for base in sorted({0, T - 1, T // 2}):
            row = {"method": "chained" if chained else "fixed", "base": str(periods[base]), "series": {}}
            for f in ("laspeyres", "paasche", "fisher", "tornqvist"):
                row["series"][f] = series(P, Q, f, chained, base)
            expect.append(row)
    return {"name": name, "data": "\n".join(lines), "periods": [str(p) for p in periods], "expect": expect}


cases = []
# 1. A small basket, tab-separated, P/Q headers.
items = ["Bread", "Milk", "Coffee", "Bus fare", "Electricity"]
Pstr = [["2.50", "1.10", "8.00", "2.00", "0.15"], ["2.80", "1.25", "9.20", "2.00", "0.21"], ["3.05", "1.32", "9.90", "2.25", "0.24"], ["3.10", "1.30", "9.50", "2.40", "0.22"]]
Qstr = [["120", "200", "30", "80", "900"], ["115", "190", "26", "85", "820"], ["110", "195", "24", "82", "800"], ["112", "205", "27", "78", "850"]]
cases.append(case("basket_tab", "\t", items, [2021, 2022, 2023, 2024], Pstr, Qstr))

# 2. 30 items, 6 periods, random walk prices (2 decimals) and quantities (some zero, some decimal), seed 7.
rnd = random.Random(7)
items2 = [f"Item {k + 1}" for k in range(30)]
p = [rnd.uniform(1, 50) for _ in items2]
q = [rnd.uniform(5, 500) for _ in items2]
P2, Q2 = [], []
for t in range(6):
    P2.append([f"{v:.2f}" for v in p])
    Q2.append(["0" if (t == 2 and k == 4) else f"{v:.1f}" for k, v in enumerate(q)])
    p = [max(0.05, v * (1 + rnd.gauss(0.02, 0.08))) for v in p]
    q = [max(0.5, v * (1 + rnd.gauss(0.0, 0.15))) for v in q]
cases.append(case("random30_tab", "\t", items2, [f"Y{t + 1}" for t in range(6)], P2, Q2))

# 3. A European CSV (semicolon-separated, decimal commas), "Price 2020" / "Qty 2020" headers.
items3 = ["Äpfel", "Brot", "Käse", "Strom", "Miete", "Kaffee", "Bahn", "Kino"]
P3 = [["2,49", "3,10", "12,90", "0,32", "9,80", "7,99", "1,90", "11,50"],
      ["2,69", "3,25", "13,40", "0,41", "10,10", "8,49", "1,90", "12,00"],
      ["2,59", "3,45", "14,10", "0,37", "10,45", "8,99", "2,10", "12,50"]]
Q3 = [["50", "40", "8", "3200", "70", "12", "60", "6"],
      ["48", "41", "7,5", "2900", "70", "11", "64", "5"],
      ["52", "39", "7", "3000", "71", "11,5", "58", "6"]]
cases.append(case("euro_semicolon", ";", items3, [2020, 2021, 2022], P3, Q3, header_style="Price"))

# idx-deflate: real = nominal * index(base) / index(t), rebased index = index(t) / index(base) * 100, cumulative
# inflation = index(to) / index(from) - 1, all exact.
def deflate_case(name, labels, nominal, cpi, base, frm, to):
    N = [F(s) for s in nominal]
    C = [F(s) for s in cpi]
    b = labels.index(base)
    f = labels.index(frm)
    t = labels.index(to)
    return {
        "name": name,
        "data": "\n".join(["Date\tNominal\tCPI"] + [f"{l}\t{n}\t{c}" for l, n, c in zip(labels, nominal, cpi)]),
        "fields": {"base": base, "from": frm, "to": to},
        "real": [float(N[i] * C[b] / C[i]) for i in range(len(N))],
        "index": [float(C[i] / C[b] * 100) for i in range(len(N))],
        "inflation_pct": float((C[t] / C[f] - 1) * 100),
    }


rnd = random.Random(3)
deflate = []
yrs = [str(y) for y in range(2000, 2025)]
cpi = [100.0]
for _ in yrs[1:]:
    cpi.append(cpi[-1] * (1 + rnd.uniform(0.0, 0.06)))
deflate.append(deflate_case("annual", yrs, [f"{rnd.uniform(1e5, 9e6):.2f}" for _ in yrs], [f"{c:.3f}" for c in cpi], "2024", "2000", "2024"))
months = [f"{y}-{m:02d}" for y in (2022, 2023) for m in range(1, 13)]
mc = [f"{300 + 0.8 * k + rnd.uniform(-0.5, 0.5):.3f}" for k in range(len(months))]
deflate.append(deflate_case("monthly_mid_base", months, [f"{rnd.uniform(-5e4, 2e5):.2f}" for _ in months], mc, "2022-07", "2022-03", "2023-11"))
qs = ["2019-Q1", "2019-Q2", "2019-Q4", "2020-Q1", "2020-Q2"]
deflate.append(deflate_case("quarterly_gap", qs, ["1000.00", "1010.50", "990.25", "1200.00", "1234567.89"], ["98.7", "99.1", "100.4", "101.0", "100.2"], "2019-Q4", "2019-Q1", "2020-Q2"))

with open(OUT, "w", encoding="utf-8") as fh:
    json.dump({"source": "scripts/econ-index-oracle.py (fractions + mpmath 60 digits)", "cases": cases, "deflate": deflate}, fh, indent=1, ensure_ascii=False)
print("wrote", OUT, len(cases), "cases")
