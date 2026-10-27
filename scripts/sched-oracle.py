"""Oracle for release F1 schedules and statement analysis (src/lib/loanSchedule.ts, depreciation.ts, macrs.ts,
statements.ts).

Run:  ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/sched-oracle.py
Writes src/lib/__tests__/fixtures/sched-oracle.json.

Sources, by part:
  Plain and balloon loans   numpy-financial pmt / ipmt / ppmt (pmt with fv = -balloon), row by row.
  Extra payments, one-off   an independent loop written here from the stated conventions (extra to principal,
  payments, rate changes    level payment kept, extra cut to the balance, recast on a rate change over the payments
                            left to the same balloon); its no-extra case is checked against numpy-financial first.
  Depreciation              transcriptions of Excel SLN, SYD, DDB and VDB (whole periods, no_switch FALSE), each checked
                            here against Microsoft's worked examples on the function pages (SLN 30000/7500/10 = 2250;
                            SYD year 1 = 4090.91, year 10 = 409.09; DDB 2400/300/10 year 1 = 480, year 2 = 384,
                            year 10 = 22.12, factor 1.5 year 1 = 360, monthly 40.00, daily 1.32; VDB 2400/300 over
                            120 months, periods 6 to 18 = 396.31, factor 1.5 = 311.81).
  MACRS                     every column of IRS Pub 946 (2025) Tables A-1 to A-5 and A-8 to A-12 re-derived from the
                            method in exact Fractions (declining balance switching to straight line, or straight line;
                            half-year or mid-quarter first year; each year's rate rounded half-up from the rounded
                            remaining percentage). Only the column keys and printed decimals are read from
                            src/lib/macrsTables.ts, never its rates.
  Ratios, DuPont, common    exact Fractions on the calculator's default statement (invented numbers, hand-checkable).
  size, Altman, CVP
"""
import json
import os
import re
from fractions import Fraction as F

import numpy_financial as npf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "src", "lib", "__tests__", "fixtures", "sched-oracle.json")


def close(a, b, tol):
    assert abs(a - b) <= tol, (a, b)


# ----------------------------------------------------------------------------------------------------------------
# Loans
# ----------------------------------------------------------------------------------------------------------------

def loan_loop(P, annual, n, m, balloon=0.0, amortN=None, extra=0.0, extra_from=1, lumps=None, changes=None):
    lumps = lumps or {}
    changes = dict(changes or {})
    i = annual / m

    def pmt(pv, rate, nper, fv=0.0):
        if rate == 0:
            return (pv - fv) / nper
        v = (1 + rate) ** -nper
        return (pv - fv * v) * rate / (1 - v)

    pay = pmt(P, i, amortN) if amortN else pmt(P, i, n, balloon)
    bal = P
    rows = []
    tiny = 1e-9 * max(1, P)
    k = 0
    for k in range(1, n + 1):
        if bal <= tiny:
            k -= 1
            break
        if k in changes and k > 1:
            i = changes[k] / m
            pay = pmt(bal, i, amortN - k + 1) if amortN else pmt(bal, i, n - k + 1, min(balloon, bal))
        interest = bal * i
        sched = pay - interest
        p = pay
        ex = 0.0
        if k == n or sched >= bal:
            sched = bal
            p = bal + interest
        else:
            ex = (extra if k >= extra_from else 0.0) + lumps.get(k, 0.0)
            ex = min(ex, bal - sched)
        bal -= sched + ex
        if abs(bal) <= tiny:
            bal = 0.0
        rows.append({"k": k, "payment": p, "extra": ex, "interest": interest, "principal": sched + ex, "balance": bal})
    return rows


def loan_case(name, **kw):
    rows = loan_loop(**kw)
    return {
        "name": name,
        "input": kw | {"lumps": [[k, v] for k, v in (kw.get("lumps") or {}).items()], "changes": [[k, v] for k, v in (kw.get("changes") or {}).items()]},
        "payoffK": len(rows),
        "totalInterest": sum(r["interest"] for r in rows),
        "totalPaid": sum(r["payment"] + r["extra"] for r in rows),
        "rows": [rows[j] for j in sorted({0, 1, 11, 59, 60, len(rows) // 2, len(rows) - 2, len(rows) - 1}) if 0 <= j < len(rows)],
    }


loans = []
# numpy-financial first: the loop with no extras equals ipmt/ppmt row by row
for (P, r, n, m, B) in [(250000, 0.06, 360, 12, 0.0), (250000, 0.06, 360, 12, 100000.0), (18000, 0.0725, 60, 12, 0.0), (1e6, 0.045, 40, 4, 250000.0)]:
    rows = loan_loop(P, r, n, m, balloon=B)
    pay = float(npf.pmt(r / m, n, -P, B))
    close(rows[0]["payment"], pay, 1e-9 * P)
    per = list(range(1, n + 1))
    ip = -npf.ipmt(r / m, per, n, P, -B)
    pp = -npf.ppmt(r / m, per, n, P, -B)
    for j, row in enumerate(rows[:-1]):
        close(row["interest"], float(ip[j]), 1e-7)
        close(row["principal"], float(pp[j]), 1e-7)
    loans.append(loan_case(f"plain {P} {r} {n}/{m} balloon {B}", P=P, annual=r, n=n, m=m, balloon=B) | {"npfPayment": pay})
loans.append(loan_case("zero rate", P=12000, annual=0.0, n=24, m=12))
loans.append(loan_case("extra 200 + lump 10000 at 60", P=250000, annual=0.06, n=360, m=12, extra=200.0, extra_from=1, lumps={60: 10000.0}))
loans.append(loan_case("extra from payment 13", P=180000, annual=0.055, n=180, m=12, extra=150.0, extra_from=13))
loans.append(loan_case("lump larger than balance", P=50000, annual=0.05, n=60, m=12, lumps={30: 1e6}))
loans.append(loan_case("rate changes", P=300000, annual=0.04, n=360, m=12, changes={61: 0.065, 121: 0.05}))
loans.append(loan_case("rate changes with extras", P=300000, annual=0.04, n=360, m=12, extra=300.0, changes={61: 0.065}))
loans.append(loan_case("balloon with extras", P=500000, annual=0.07, n=84, m=12, balloon=350000.0, extra=1000.0))
loans.append(loan_case("amortise 30y due 7y", P=500000, annual=0.07, n=84, m=12, amortN=360))
loans.append(loan_case("biweekly", P=200000, annual=0.05, n=26 * 25, m=26, extra=50.0))

# ----------------------------------------------------------------------------------------------------------------
# Depreciation (Excel transcriptions)
# ----------------------------------------------------------------------------------------------------------------

def sln(c, s, L):
    return (c - s) / L


def syd(c, s, L, per):
    return (c - s) * (L - per + 1) * 2 / (L * (L + 1))


def ddb(c, s, L, per, factor=2.0):
    book = c
    d = 0.0
    for _ in range(int(per)):
        d = min(book * factor / L, max(0.0, book - s))
        d = max(0.0, d)
        book -= d
    return d


def vdb_periods(c, s, L, factor=2.0):
    """Excel VDB per whole period, no_switch FALSE (LibreOffice ScVDB's whole-period path)."""
    out = []
    book = c
    switched = False
    sl_amt = 0.0
    for per in range(1, int(L) + 1):
        db = min(book * factor / L, max(0.0, book - s))
        if not switched:
            sl = (book - s) / (L - per + 1)
            if sl > db:
                switched = True
                sl_amt = sl
        d = sl_amt if switched else db
        if per == int(L) and switched:
            d = book - s
        out.append(d)
        book -= d
    return out


close(sln(30000, 7500, 10), 2250, 1e-12)
close(round(syd(30000, 7500, 10, 1), 2), 4090.91, 1e-9)
close(round(syd(30000, 7500, 10, 10), 2), 409.09, 1e-9)
close(round(ddb(2400, 300, 10, 1), 2), 480.00, 1e-9)
close(round(ddb(2400, 300, 10, 2), 2), 384.00, 1e-9)
close(round(ddb(2400, 300, 10, 10), 2), 22.12, 1e-9)
close(round(ddb(2400, 300, 10, 1, 1.5), 2), 360.00, 1e-9)
close(round(ddb(2400, 300, 120, 1), 2), 40.00, 1e-9)
close(round(ddb(2400, 300, 3650, 1), 2), 1.32, 1e-9)
close(round(sum(vdb_periods(2400, 300, 120)[6:18]), 2), 396.31, 1e-9)
close(round(sum(vdb_periods(2400, 300, 120, 1.5)[6:18]), 2), 311.81, 1e-9)

depr = []
for (c, s, L, fac) in [(10000, 0, 5, 2.0), (10000, 1000, 5, 2.0), (10000, 1000, 5, 1.5), (2400, 300, 10, 2.0), (2400, 300, 10, 1.5), (50000, 2000, 8, 2.0), (900, 0, 1, 2.0), (1000, 0, 3, 3.0)]:
    depr.append({
        "cost": c, "salvage": s, "life": L, "factor": fac,
        "sl": [sln(c, s, L)] * L,
        "syd": [syd(c, s, L, k) for k in range(1, L + 1)],
        "db": [ddb(c, s, L, k, fac) for k in range(1, L + 1)],
        "dbsl": vdb_periods(c, s, L, fac),
    })
uop = {"cost": 10000, "salvage": 1000, "units": [1200, 1500, 1000, 800, 500], "total": 5000,
       "dep": [float(F(9000) * u / 5000) for u in [1200, 1500, 1000, 800, 500]]}

# ----------------------------------------------------------------------------------------------------------------
# MACRS: re-derive every column
# ----------------------------------------------------------------------------------------------------------------

src = open(os.path.join(ROOT, "src", "lib", "macrsTables.ts"), encoding="utf8").read()
FIRST = {"hy": F(1, 2), "q1": F(21, 24), "q2": F(15, 24), "q3": F(9, 24), "q4": F(3, 24)}
CONV_OF = {"A-1": "hy", "A-2": "q1", "A-3": "q2", "A-4": "q3", "A-5": "q4", "A-8": "hy", "A-9": "q1", "A-10": "q2", "A-11": "q3", "A-12": "q4"}


def rnd(x, dp):
    s = 10 ** dp
    return F((2 * x.numerator * s + x.denominator) // (2 * x.denominator), s)


def method(L, mult, conv, dp):
    L = F(L)
    rate = F(mult) / L
    f1 = FIRST[conv]
    rem = F(100)
    out = []
    k = 1
    while rem > 0 and k <= 60:
        if k == 1:
            r = rnd(rem * rate * f1, dp)
        else:
            left = L - f1 - (k - 2)
            r = rem if left <= 1 else rnd(max(rem * rate, rem / left), dp)
        r = min(r, rem)
        out.append(f"{float(r):.{dp}f}")
        rem -= r
        k += 1
    return out


macrs = {}
for tbl, body in re.findall(r'"(A-\d+)": \{\n(.*?)\n  \}', src, re.S):
    for key, col in re.findall(r'"([\d.]+)": "([^"]+)"', body):
        dp = max(len(v.split(".")[1]) if "." in v else 0 for v in col.split())
        gds = tbl in ("A-1", "A-2", "A-3", "A-4", "A-5")
        mult = ("1.5" if float(key) >= 15 else "2") if gds else "1"
        macrs[f"{tbl}|{key}"] = {"dp": dp, "method": method(key, mult, CONV_OF[tbl], dp)}
assert len(macrs) == 30 + 5 * 39, len(macrs)

# ----------------------------------------------------------------------------------------------------------------
# Statements (exact)
# ----------------------------------------------------------------------------------------------------------------

cur = dict(rev=1200000, cogs=720000, opex=300000, ebit=180000, int=30000, ebt=150000, tax=F(37500), ni=112500, cash=60000,
           ar=150000, inv=180000, ca=400000, ta=1000000, ap=90000, cl=200000, ltd=300000, tl=500000, re=350000, eq=500000)
pri = dict(rev=1050000, cogs=651000, opex=270000, ebit=129000, int=29000, ebt=100000, tax=25000, ni=75000, cash=45000,
           ar=140000, inv=170000, ca=365000, ta=920000, ap=85000, cl=190000, ltd=310000, tl=500000, re=270000, eq=420000)


def ratios(d, avg=None, days=365):
    d = {k: F(v) for k, v in d.items()}
    b = (lambda k: (d[k] + F(avg[k])) / 2) if avg else (lambda k: d[k])
    out = {
        "Current ratio": d["ca"] / d["cl"],
        "Quick ratio": (d["cash"] + d["ar"]) / d["cl"],
        "Cash ratio": d["cash"] / d["cl"],
        "Debt ratio": d["tl"] / d["ta"],
        "Debt-to-equity": d["tl"] / d["eq"],
        "Equity multiplier": b("ta") / b("eq"),
        "Interest coverage": d["ebit"] / d["int"],
        "Asset turnover": d["rev"] / b("ta"),
        "Inventory turnover": d["cogs"] / b("inv"),
        "Days inventory outstanding": days * b("inv") / d["cogs"],
        "Receivables turnover": d["rev"] / b("ar"),
        "Days sales outstanding": days * b("ar") / d["rev"],
        "Payables turnover": d["cogs"] / b("ap"),
        "Days payables outstanding": days * b("ap") / d["cogs"],
        "Gross margin": (d["rev"] - d["cogs"]) / d["rev"],
        "Operating margin": d["ebit"] / d["rev"],
        "Net margin": d["ni"] / d["rev"],
        "Return on assets": d["ni"] / b("ta"),
        "Return on equity": d["ni"] / b("eq"),
    }
    out["Cash conversion cycle"] = out["Days inventory outstanding"] + out["Days sales outstanding"] - out["Days payables outstanding"]
    dup5 = [d["ni"] / d["ebt"], d["ebt"] / d["ebit"], d["ebit"] / d["rev"], d["rev"] / b("ta"), b("ta") / b("eq")]
    prod = F(1)
    for x in dup5:
        prod *= x
    assert prod == out["Return on equity"]
    assert out["Net margin"] * out["Asset turnover"] * out["Equity multiplier"] == out["Return on equity"]
    return {k: [v.numerator, v.denominator] for k, v in out.items()}, [[x.numerator, x.denominator] for x in dup5]


r_end, d_end = ratios(cur)
r_pri, _ = ratios(pri)
r_avg, d_avg = ratios(cur, avg=pri)
r_360, _ = ratios(cur, days=360)

# Altman (the altman-z default statement)
alt = dict(ca=F(400000), cl=F(200000), ta=F(1000000), re=F(350000), ebit=F(180000), sales=F(1200000), tl=F(500000), eq=F(500000), mve=F(900000))
X = [(alt["ca"] - alt["cl"]) / alt["ta"], alt["re"] / alt["ta"], alt["ebit"] / alt["ta"]]
z = F("1.2") * X[0] + F("1.4") * X[1] + F("3.3") * X[2] + F("0.6") * alt["mve"] / alt["tl"] + alt["sales"] / alt["ta"]
zp = F("0.717") * X[0] + F("0.847") * X[1] + F("3.107") * X[2] + F("0.420") * alt["eq"] / alt["tl"] + F("0.998") * alt["sales"] / alt["ta"]
zpp = F("6.56") * X[0] + F("3.26") * X[1] + F("6.72") * X[2] + F("1.05") * alt["eq"] / alt["tl"]
# the 1968 paper's percent form gives the same Z up to its 0.999 rounding of the X5 coefficient
z_paper = F("0.012") * 100 * X[0] + F("0.014") * 100 * X[1] + F("0.033") * 100 * X[2] + F("0.006") * 100 * alt["mve"] / alt["tl"] + F("0.999") * alt["sales"] / alt["ta"]
assert abs(z_paper - z) == F("0.001") * alt["sales"] / alt["ta"]

# CVP
p, v, fc, u, tgt = F(50), F(30), F(40000), F(3000), F(20000)
cm = p - v
cvp = {
    "cmUnit": cm, "cmRatio": cm / p, "breakEvenUnits": fc / cm, "breakEvenRevenue": fc / cm * p,
    "operatingIncome": p * u - fc - v * u, "marginOfSafetyPct": (u - fc / cm) / u, "dol": cm * u / (p * u - fc - v * u),
    "targetUnits": (fc + tgt) / cm,
}
cvp2_in = dict(price=F("19.99"), vc=F("12.49"), fixed=F("123456.78"), units=F(15000), target=F(-5000))
cm2 = cvp2_in["price"] - cvp2_in["vc"]
oi2 = cm2 * cvp2_in["units"] - cvp2_in["fixed"]
cvp2 = {"cmUnit": cm2, "breakEvenUnits": cvp2_in["fixed"] / cm2, "operatingIncome": oi2, "dol": cm2 * cvp2_in["units"] / oi2, "targetUnits": (cvp2_in["fixed"] + cvp2_in["target"]) / cm2}
CVP2_DEC = {"price": "19.99", "vc": "12.49", "fixed": "123456.78", "units": "15000", "target": "-5000"}
assert all(F(CVP2_DEC[k]) == cvp2_in[k] for k in CVP2_DEC)

fr = lambda x: [x.numerator, x.denominator]
out = {
    "loans": loans,
    "depr": depr,
    "uop": uop,
    "macrs": macrs,
    "ratios": {"end": r_end, "prior": r_pri, "average": r_avg, "days360": r_360, "dupont5_end": d_end, "dupont5_avg": d_avg},
    "altman": {"z": fr(z), "zprime": fr(zp), "zdouble": fr(zpp)},
    "cvp": {k: fr(v) for k, v in cvp.items()},
    "cvp2": {"input": CVP2_DEC, "out": {k: fr(v) for k, v in cvp2.items()}},
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf8", newline="\n") as f:
    json.dump(out, f, indent=1)
print("wrote", OUT, "loans", len(loans), "depr", len(depr), "macrs columns", len(macrs))
