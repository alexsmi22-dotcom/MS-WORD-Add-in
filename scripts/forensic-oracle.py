"""
Oracle for the Release F2 forensic and actuarial calculators (gap items #8 and #17): writes
src/lib/__tests__/fixtures/forensic-oracle.json, which src/lib/__tests__/forensic.test.ts compares against.

Independent re-implementations from the stated conventions (not ports of the TypeScript):
  A. The Illustrative Life Table (Bowers, Gerber, Hickman, Jones & Nesbitt, Actuarial Mathematics, Society of
     Actuaries, Appendix 2A; as printed in the Society of Actuaries' Exam MLC tables, "Illustrative Life Table: Basic
     Functions and Single Benefit Premiums at i = 0.06", https://www.soa.org/globalassets/assets/files/edu/edu-2008-spring-mlc-tables.pdf).
     Ages 13 and over follow Makeham's law 1000 mu(x) = 0.7 + 0.05 x 10^(0.04 x). The qx column is generated here
     (ages 13-140) and the PUBLISHED values (transcribed from the SOA pages, 4-dp a-due, 2-dp 1000A, 1000 2A and
     1000 nEx) are stored beside the values recomputed here; the script asserts they agree at the printed rounding.
  B. Commutation-function factors from the bundled CDC 2024 qx (read from src/lib/usLifeTable2024.ts), extended past
     100 at the one-year survival (2 e100 - 1)/(2 e100 + 1) and closed at 131.
  C. Lost earnings (LPE / WLE), with prejudgment interest computed in exact rational arithmetic.
  D. The retirement schedule (with numpy_financial.fv as a cross-check of the accumulation phase).
  E. The safe-withdrawal Monte Carlo with an independent PCG32 (pcg_basic.c), Box-Muller and type-7 percentiles.

Run: ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/forensic-oracle.py
"""
import datetime as dt
import json
import math
import re
from fractions import Fraction
from pathlib import Path

import numpy as np
import numpy_financial as npf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "lib" / "__tests__" / "fixtures" / "forensic-oracle.json"

# ---------------------------------------------------------------------------------------------------------------
# Life tables
# ---------------------------------------------------------------------------------------------------------------


class Table:
    def __init__(self, start, lx):
        self.start = start
        self.lx = lx  # ends with 0

    def l_at(self, age):
        k = age - self.start
        if k < 0:
            return float("nan")
        if k >= len(self.lx) - 1:
            return 0.0
        i = math.floor(k)
        f = k - i
        return self.lx[i] + (self.lx[i + 1] - self.lx[i]) * f

    def comm(self, i):
        v = 1 / (1 + i)
        n = len(self.lx)
        D = [v ** (self.start + k) * self.lx[k] for k in range(n)]
        C = [v ** (self.start + k + 1) * (self.lx[k] - self.lx[k + 1]) if k < n - 1 else 0.0 for k in range(n)]
        N = [0.0] * n
        M = [0.0] * n
        s = m = 0.0
        for k in range(n - 1, -1, -1):
            s += D[k]
            m += C[k]
            N[k] = s
            M[k] = m
        return D, N, C, M

    def factors(self, x, i, n, m):
        D, N, C, M = self.comm(i)
        k = x - self.start
        at = lambda a, j: a[j] if j < len(a) else 0.0
        Dx = D[k]
        return {
            "ad": N[k] / Dx,
            "a": at(N, k + 1) / Dx,
            "A": M[k] / Dx,
            "adn": (N[k] - at(N, k + n)) / Dx,
            "an": (at(N, k + 1) - at(N, k + n + 1)) / Dx,
            "A1n": (M[k] - at(M, k + n)) / Dx,
            "nE": at(D, k + n) / Dx,
            "mad": at(N, k + m) / Dx,
            "madn": (at(N, k + m) - at(N, k + m + n)) / Dx,
        }


def table_from_qx(start, qx):
    lx = [100000.0]
    for q in qx[:-1]:
        lx.append(lx[-1] * (1 - q))
    lx.append(0.0)
    return Table(start, lx)


def cdc(sex):
    src = (ROOT / "src" / "lib" / "usLifeTable2024.ts").read_text(encoding="utf-8")
    block = re.search(sex + r": \{\s*e100: ([0-9.]+),\s*qx: \[([^\]]*)\]", src)
    e100 = float(block.group(1))
    qx = [float(t) for t in block.group(2).replace("\n", " ").split(",") if t.strip()]
    assert len(qx) == 101
    lx = [100000.0]
    for x in range(100):
        lx.append(lx[x] * (1 - qx[x]))
    p = (2 * e100 - 1) / (2 * e100 + 1)
    for x in range(100, 130):
        lx.append(lx[x] * p)
    lx.append(0.0)
    return Table(0, lx)


# A. Illustrative Life Table ------------------------------------------------------------------------------------
A_, B_, c_ = 0.0007, 0.00005, 10 ** 0.04


def makeham_s(x):
    return math.exp(-A_ * x - B_ / math.log(c_) * (c_ ** x - 1))


ILT_AGES = list(range(13, 141))
ilt_qx = [1 - makeham_s(x + 1) / makeham_s(x) for x in ILT_AGES[:-1]] + [1.0]
ilt_qx_text = "\n".join(f"{x}\t{q:.12g}" for x, q in zip(ILT_AGES, ilt_qx))
ilt_tab = table_from_qx(13, [float(f"{q:.12g}") for q in ilt_qx])

# Published values (SOA Exam MLC tables, Illustrative Life Table at i = 0.06): x: (a-due, 1000A, 1000 2A, 1000 5E, 1000 10E, 1000 20E)
ILT_PUBLISHED = {
    20: (16.5133, 65.28, 14.30, 743.16, 551.64, 301.93),
    30: (15.8561, 102.48, 25.31, 740.91, 547.33, 293.74),
    40: (14.8166, 161.32, 48.63, 735.29, 536.67, 274.14),
    50: (13.2668, 249.05, 94.76, 721.37, 510.81, 230.47),
    60: (11.1454, 369.13, 177.41, 687.56, 451.20, 149.06),
    65: (9.8969, 439.80, 236.03, 656.23, 399.94, 97.60),
    70: (8.5693, 514.95, 306.42, 609.46, 330.37, 49.88),
    75: (7.2170, 591.49, 386.81, 542.07, 244.03, 17.22),
    80: (5.9050, 665.75, 473.59, 450.19, 151.00, 3.19),
    90: (3.6488, 793.46, 644.96, 210.36, 21.13, 0.00),
    100: (2.1252, 879.70, 779.08, 31.12, 0.15, 0.00),
    110: (1.3223, 925.15, 857.04, 0.26, 0.00, 0.00),
}
ILT_LX_PUBLISHED = {20: 9617802, 30: 9501381, 40: 9313166, 50: 8950901, 60: 8188074, 65: 7533964, 70: 6616155, 80: 3914365, 90: 1058491, 100: 40049}
ilt_rows = []
for x, pub in ILT_PUBLISHED.items():
    f = ilt_tab.factors(x, 0.06, 5, 0)
    f2 = ilt_tab.factors(x, 1.06 ** 2 - 1, 5, 0)
    e10 = ilt_tab.factors(x, 0.06, 10, 0)["nE"]
    e20 = ilt_tab.factors(x, 0.06, 20, 0)["nE"]
    mine = (round(f["ad"], 4), round(1000 * f["A"], 2), round(1000 * f2["A"], 2), round(1000 * f["nE"], 2), round(1000 * e10, 2), round(1000 * e20, 2))
    assert all(abs(a - b) < 1e-9 for a, b in zip(mine, pub)), (x, mine, pub)
    ilt_rows.append({"x": x, "published": pub, "ad": f["ad"], "A": f["A"], "A2": f2["A"], "E5": f["nE"], "E10": e10, "E20": e20})
for x, l in ILT_LX_PUBLISHED.items():
    assert abs(9617802 * makeham_s(x) / makeham_s(20) - l) < 1, x

# B. CDC factors -------------------------------------------------------------------------------------------------
cdc_cases = []
for sex in ("total", "male", "female"):
    t = cdc(sex)
    for x, i, n, m in [(65, 0.04, 20, 10), (40, 0.03, 25, 27), (85, 0.06, 10, 5), (0, 0.02, 30, 65), (100, 0.04, 5, 2)]:
        cdc_cases.append({"sex": sex, "x": x, "i": i, "n": n, "m": m, **t.factors(x, i, n, m)})
    # Complete expectation under UDD.
for sex in ("total",):
    t = cdc(sex)
    for x in (65, 85, 100):
        s = sum((t.lx[k] + t.lx[k + 1]) / 2 for k in range(x, len(t.lx) - 1))
        cdc_cases.append({"sex": sex, "x": x, "ex": s / t.lx[x]})

# C. Lost earnings ----------------------------------------------------------------------------------------------


def day(s):
    y, mo, d = map(int, s.split("-"))
    return dt.date(y, mo, d).toordinal()


def half_away(fr):
    # Fraction -> integer, half away from zero.
    s = 1 if fr >= 0 else -1
    a = abs(fr)
    f = a.numerator // a.denominator
    r = a - f
    return s * (f + 1 if r >= Fraction(1, 2) else f)


def cents(x):
    # The product's toCents for a double: decimal half away from zero on the binary value, with a float-precision
    # tie window; for these amounts the plain Decimal rounding of repr(x) agrees.
    from decimal import Decimal, ROUND_HALF_UP
    return int((Decimal(repr(abs(x))) * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP)) * (1 if x >= 0 else -1)


def add_year(o):
    d = dt.date.fromordinal(o)
    try:
        return dt.date(d.year + 1, d.month, d.day).toordinal()
    except ValueError:
        return dt.date(d.year + 1, d.month, 28).toordinal()


def pji(amount_cents, accrual, end, rate_pct, method):
    units = round(rate_pct * 1e4)  # millionths
    r = Fraction(units, 10 ** 6)
    if end <= accrual:
        return 0
    if method == "simple":
        return half_away(Fraction(amount_cents) * r * (end - accrual) / 365)
    bal = Fraction(amount_cents)
    cur = accrual
    k = 1
    while True:
        # anniversaries of the ORIGINAL accrual date (k years after it, clamped)
        d0 = dt.date.fromordinal(accrual)
        try:
            nxt = dt.date(d0.year + k, d0.month, d0.day).toordinal()
        except ValueError:
            nxt = dt.date(d0.year + k, d0.month, 28).toordinal()
        if nxt > end:
            break
        bal = bal * (1 + r * (nxt - cur) / 365)
        cur = nxt
        k += 1
    bal = bal * (1 + r * (end - cur) / 365)
    return half_away(bal - amount_cents)


def lpe(c):
    t = cdc(c["sex"]) if c.get("sex") else c["table"]
    dob, inj, tri = day(c["dob"]), day(c["injury"]), day(c["trial"])
    ai = (inj - dob) / 365.25
    tt = (tri - inj) / 365.25
    at_ = ai + tt
    te = c["workend"] - ai if c["method"] == "lpe" else c["wle"]
    hh_on = c["hhhours"] > 0 and c["hhvalue"] > 0
    th = max(0.0, c["hhend"] - ai) if hh_on else 0.0
    tmax = max(te, th)
    basis = at_ if c["survival"] == "trial" else ai
    lb = t.l_at(basis)

    def palive(age, past):
        return 1.0 if (c["survival"] == "trial" and past) else t.l_at(age) / lb

    def pe(age):
        r = c["pe"][0]
        for p in c["pe"]:
            if p[0] <= age + 1e-9:
                r = p
        return r[1] / 100 * r[2] / 100

    ktr = math.floor(tt) + 1
    g = c["growth"] / 100
    hg = c["hhgrowth"] / 100
    share = (1 - c["tax"] / 100 + c["fringe"] / 100) * (1 - c["consumption"] / 100)
    rate = (c["ndr"] if c["dmode"] == "ndr" else c["discount"]) / 100
    rows = []
    n = math.ceil(tmax - 1e-9)
    for k in range(1, n + 1):
        y0, y1 = k - 1, min(k, tmax)
        parts = [(y0, tt), (tt, y1)] if y0 < tt < y1 else [(y0, y1)]
        for a, b in parts:
            if b - a <= 1e-12:
                continue
            past = b <= tt + 1e-12
            gexp = ktr - 1 if (c["dmode"] == "ndr" and not past) else k - 1
            el = max(0.0, min(b, te) - max(a, 0.0))
            hl = max(0.0, min(b, th) - max(a, 0.0))
            cap = (c["base"] - c["residual"]) * (1 + g) ** gexp * el
            pa = palive(ai + a + el / 2, past) if (el > 0 and c["method"] == "lpe") else 1.0
            ppe = pe(ai + a + el / 2) if c["method"] == "lpe" else 1.0
            earn = cap * share * pa * ppe
            hh = c["hhhours"] * 52 * c["hhvalue"] * (1 + hg) ** gexp * hl * palive(ai + a + hl / 2, past) if hl > 0 else 0.0
            tot = cents(earn) + cents(hh)
            mid = (a + b) / 2
            tau = (mid if c["mid"] == "mid" else b) - tt
            if past:
                acc = inj + round(mid * 365.25)
                interest = pji(tot, min(acc, tri), tri, c["pji"], c["pjimethod"]) if c["pji"] > 0 else 0
                value = tot
            else:
                interest = 0
                value = cents(tot / 100 * (1 + rate) ** (-tau))
            rows.append({"k": k, "past": past, "capacity": cents(cap), "earn": cents(earn), "hh": cents(hh), "total": tot, "interest": interest, "value": value})
    past = sum(r["total"] for r in rows if r["past"])
    inter = sum(r["interest"] for r in rows)
    fut = sum(r["total"] for r in rows if not r["past"])
    pv = sum(r["value"] for r in rows if not r["past"])
    return {"rows": rows, "past": past, "interest": inter, "future": fut, "futurePv": pv, "total": past + inter + pv}


LPE_BASE = {
    "dob": "1979-04-12", "injury": "2023-06-30", "trial": "2026-11-02", "sex": "male", "survival": "trial",
    "base": 68000, "residual": 24000, "growth": 3, "method": "lpe", "workend": 67, "wle": 18,
    "pe": [(40, 88, 96), (50, 84, 96), (55, 76, 95), (60, 58, 95), (65, 32, 94)],
    "fringe": 20, "tax": 12, "consumption": 0, "hhhours": 8, "hhvalue": 16, "hhgrowth": 2.5, "hhend": 75,
    "dmode": "growth", "discount": 4.5, "ndr": 1.5, "mid": "mid", "pji": 5, "pjimethod": "simple",
}
LPE_VARIANTS = {
    "default": {},
    "ndr-end-annual": {"dmode": "ndr", "mid": "end", "pjimethod": "annual", "pji": 7.25},
    "wle-female": {"method": "wle", "wle": 14.5, "sex": "female", "residual": 0, "hhhours": 0},
    "death-total": {"survival": "injury", "sex": "total", "consumption": 30, "dob": "1990-02-28", "injury": "2020-02-29", "trial": "2025-03-01", "workend": 70, "hhend": 80},
    "trial-on-injury": {"trial": "2023-06-30", "pji": 0},
}
lpe_cases = []
for name, over in LPE_VARIANTS.items():
    c = {**LPE_BASE, **over}
    r = lpe(c)
    lpe_cases.append({"name": name, "inputs": {k: (list(map(list, v)) if k == "pe" else v) for k, v in c.items()}, **r})

# D. Retirement schedule ----------------------------------------------------------------------------------------


def schedule(age, retire, end, bal, contrib, wd, r, pi):
    rows = []
    out = None
    at_ret = None
    for t in range(1, end - age + 1):
        a = age + t - 1
        idx = (1 + pi) ** (t - 1)
        start = bal
        if a == retire:
            at_ret = start / idx
        if a < retire:
            flow = contrib * idx
        else:
            want = wd * idx
            if want > start + 1e-9 * max(1, want):
                flow = -start
                out = a if out is None else out
            else:
                flow = -want
        after = max(0.0, start + flow)
        bal = after * (1 + r)
        rows.append({"age": a, "start": start, "flow": flow, "end": bal, "real": bal / (1 + pi) ** t})
    return rows, at_ret, out


ret_cases = []
for args in [(45, 67, 95, 250000, 18000, 60000, 0.06, 0.025), (60, 62, 100, 900000, 0, 70000, 0.05, 0.03), (30, 65, 66, 0, 10000, 5000, 0.07, 0.0)]:
    rows, at_ret, out = schedule(*args)
    ret_cases.append({"args": list(args), "rows": rows, "atRetireReal": at_ret, "runsOut": out})
# numpy_financial cross-check of the accumulation phase with no inflation (payments at the start of each year).
acc, _, _ = schedule(30, 65, 66, 0, 10000, 5000, 0.07, 0.0)
fv = -npf.fv(0.07, 35, 10000, 0, when="begin")
assert abs(acc[34]["end"] - fv) < 1e-6 * fv, (acc[34]["end"], fv)

# E. Safe-withdrawal Monte Carlo --------------------------------------------------------------------------------
M64 = (1 << 64) - 1
MULT = 6364136223846793005


class Pcg32:
    def __init__(self, seed, stream=54):
        self.inc = ((stream << 1) | 1) & M64
        self.state = 0
        self.next()
        self.state = (self.state + seed) & M64
        self.next()

    def next(self):
        old = self.state
        self.state = (old * MULT + self.inc) & M64
        xs = (((old >> 18) ^ old) >> 27) & 0xFFFFFFFF
        rot = old >> 59
        return ((xs >> rot) | (xs << ((-rot) & 31))) & 0xFFFFFFFF


_r = Pcg32(42, 54)
assert [_r.next() for _ in range(3)] == [0xA15C02B7, 0x7B47F409, 0xBA1D3330]


def type7(a, p):
    s = np.sort(a)
    h = (len(s) - 1) * p
    lo = math.floor(h)
    hi = min(len(s) - 1, lo + 1)
    return s[lo] + (h - lo) * (s[hi] - s[lo])


def swr(balance, wd, years, mean, sd, paths, seed, alive=None):
    s2 = math.log(1 + sd * sd / ((1 + mean) ** 2))
    s = math.sqrt(s2)
    m = math.log(1 + mean) - s2 / 2
    rng = Pcg32(seed)
    bal = np.full(paths, float(balance))
    ruined = np.zeros(paths, dtype=bool)
    ruin_by, p10, p50, p90 = [], [], [], []
    count = 0
    wa = 0.0
    for t in range(years):
        newly = 0
        for j in range(paths):
            u1 = (rng.next() + 0.5) / 4294967296.0
            u2 = (rng.next() + 0.5) / 4294967296.0
            if ruined[j]:
                continue
            if bal[j] < wd:
                ruined[j] = True
                bal[j] = 0.0
                newly += 1
                continue
            z = math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)
            bal[j] = (bal[j] - wd) * math.exp(m + s * z)
        count += newly
        if alive is not None:
            wa += newly / paths * alive[t]
        ruin_by.append(count / paths)
        p10.append(type7(bal, 0.1))
        p50.append(type7(bal, 0.5))
        p90.append(type7(bal, 0.9))
    return {"ruinBy": ruin_by, "p10": p10, "p50": p50, "p90": p90, "whileAlive": wa if alive is not None else None}


tot = cdc("total")
alive65 = [tot.l_at(65 + k) / tot.l_at(65) for k in range(30)]
swr_cases = [
    {"args": [1000000, 40000, 30, 0.04, 0.12, 20000, 20261027], "alive": "total65", **swr(1000000, 40000, 30, 0.04, 0.12, 20000, 20261027, alive65)},
    {"args": [500000, 30000, 25, 0.02, 0.0, 1000, 7], "alive": None, **swr(500000, 30000, 25, 0.02, 0.0, 1000, 7)},
    {"args": [800000, 64000, 20, 0.03, 0.18, 3000, 42], "alive": None, **swr(800000, 64000, 20, 0.03, 0.18, 3000, 42)},
]
# Deterministic check (sd = 0): ruin happens in the first year whose start balance is below the withdrawal.
b, yr = 500000.0, None
for t in range(25):
    if b < 30000:
        yr = t
        break
    b = (b - 30000) * 1.02
assert swr_cases[1]["ruinBy"][yr] == 1.0 and (yr == 0 or swr_cases[1]["ruinBy"][yr - 1] == 0.0)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(
    json.dumps(
        {
            "source": "scripts/forensic-oracle.py",
            "ilt": {"qxText": ilt_qx_text, "rows": ilt_rows},
            "cdc": cdc_cases,
            "lpe": lpe_cases,
            "retire": ret_cases,
            "swr": swr_cases,
        },
        indent=1,
    ),
    encoding="utf-8",
)
print("wrote", OUT, "| ILT published values reproduced at", len(ilt_rows), "ages; deterministic ruin year", yr + 1)
