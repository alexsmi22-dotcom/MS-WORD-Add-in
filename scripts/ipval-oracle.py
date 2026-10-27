"""
Oracle for Release F1 gap items #1 and #2 (src/lib/ipValuation.ts, src/lib/apportionment.ts).
Writes src/lib/__tests__/fixtures/ipval-oracle.json.

Run:  ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/ipval-oracle.py

Re-implementations from the conventions in the engines' file headers:
  - Relief-from-royalty, income approach, TAB factor, comparable licence: plain Python floats with ** (pow), written
    from the stated formulas (not from the TS code);
    end-of-year cases are cross-checked against numpy_financial.npv(d, [0] + cash flows) (npv discounts values[0] at
    t = 0, hence the leading 0). Tolerance in jest: 1e-9 relative.
  - Monte Carlo: PCG32 re-implemented with 64-bit integers (pcg_basic.c, srandom(initstate=seed, initseq=54)),
    self-checked against the published pcg-c demo output (seed 42, stream 54); same uniform, triangular, lognormal
    (Box-Muller) transforms, same draw order and DELIBERATELY the engine's own year recurrences (npv_one mirrors
    npvOne, including its full-year branch), so a fixed seed reproduces the TS draws; the recurrence path itself is
    tied to the pow path by a jest test (an all-fixed Monte Carlo equals the relief-from-royalty PV less the price).
    The quantiles are type 7 (cross-checked against numpy.percentile, method "linear"). Tolerance in jest: 1e-12
    relative (V8 and the MSVC C runtime may differ by an ulp in log/cos/pow); the negative-draw count must match exactly.
  - Apportionment worksheet, EMVR vs SSPPU, Nash split: exact fractions.Fraction from the typed decimal text, each
    displayed amount rounded once to the cent, half away from zero (decimal ROUND_HALF_UP on the absolute value);
    jest compares the printed cells exactly.
"""
import json
import math
import os
from decimal import Decimal, ROUND_HALF_UP
from fractions import Fraction

import numpy as np
import numpy_financial as npf

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "lib", "__tests__", "fixtures", "ipval-oracle.json")

# ---------------------------------------------------------------------------
# PCG32
# ---------------------------------------------------------------------------
M64 = (1 << 64) - 1
MULT = 6364136223846793005


class Pcg32:
    def __init__(self, seed, stream=54):
        self.inc = ((stream << 1) | 1) & M64
        self.state = 0
        self.next_u32()
        self.state = (self.state + seed) & M64
        self.next_u32()

    def next_u32(self):
        old = self.state
        self.state = (old * MULT + self.inc) & M64
        xorshifted = (((old >> 18) ^ old) >> 27) & 0xFFFFFFFF
        rot = old >> 59
        return ((xorshifted >> rot) | (xorshifted << ((-rot) & 31))) & 0xFFFFFFFF


_ref = Pcg32(42, 54)
assert [_ref.next_u32() for _ in range(6)] == [0xA15C02B7, 0x7B47F409, 0xBA1D3330, 0x83D2F293, 0xBFA4784B, 0xCBED606E], "PCG32 self-check failed"

Z90 = 1.2815515655446004
TWO32 = 4294967296.0
CAPS = [1e12, 100.0, 50.0, 100.0]


def npv_one(rev, rate_pct, life, d_pct, g, tax_pct, cost, timing, straight):
    v = 1 / (1 + d_pct / 100)
    mid = timing == "mid"
    h_full = math.sqrt(v) if mid else v
    G = 1 + g / 100
    n = math.ceil(life - 1e-12)
    vb = 1.0
    gk = 1.0
    s = 0.0
    for k in range(1, n + 1):
        w = 1.0 if k < n else life - (k - 1)
        if w > 1:
            w = 1.0
        df = vb * (h_full if w == 1 else (v ** (w / 2) if mid else v ** w))
        surv = 1 - (k - 1 + w / 2) / life if straight else 1.0
        s += gk * w * surv * df
        vb *= v
        gk *= G
    return rev * (rate_pct / 100) * (1 - tax_pct / 100) * s - cost


def central(d):
    k, p = d
    return p[1] if k == "tri" else math.sqrt(p[0] * p[1]) if k == "logn" else p[0]


def q7(sorted_x, p):
    n = len(sorted_x)
    h = (n - 1) * p
    lo = math.floor(h)
    hi = min(n - 1, lo + 1)
    return sorted_x[lo] + (h - lo) * (sorted_x[hi] - sorted_x[lo])


def monte_carlo(case):
    rng = Pcg32(case["seed"], 54)
    dists = [case["revenue"], case["rate"], case["life"], case["disc"]]
    capped = [0, 0, 0, 0]

    def u():
        return (rng.next_u32() + 0.5) / TWO32

    def draw(i):
        kind, p = dists[i]
        if kind == "fixed":
            return p[0]
        if kind == "tri":
            a, c, b = p
            uu = u()
            ba = b - a
            if ba == 0:
                x = a
            else:
                fc = (c - a) / ba
                x = a + math.sqrt(uu * ba * (c - a)) if uu < fc else b - math.sqrt((1 - uu) * ba * (b - c))
        else:
            mu = math.log(math.sqrt(p[0] * p[1]))
            sigma = math.log(p[1] / p[0]) / (2 * Z90)
            u1 = u()
            u2 = u()
            x = math.exp(mu + sigma * (math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)))
        if x > CAPS[i]:
            capped[i] += 1
            x = CAPS[i]
        return x

    n = case["samples"]
    out = []
    for _ in range(n):
        rev = draw(0)
        rate = draw(1)
        life = draw(2)
        disc = draw(3)
        out.append(npv_one(rev, rate, life, disc, case["growth"], case["tax"], case["cost"], case["timing"], case["straight"]))
    s = 0.0
    neg = 0
    for x in out:
        s += x
        if x < 0:
            neg += 1
    mean = s / n
    ss = 0.0
    for x in out:
        e = x - mean
        ss += e * e
    sd = math.sqrt(ss / (n - 1))
    srt = sorted(out)
    qs = {p: q7(srt, p) for p in (0.1, 0.5, 0.9)}
    arr = np.array(out)
    for p in (0.1, 0.5, 0.9):
        assert abs(np.percentile(arr, p * 100, method="linear") - qs[p]) <= 1e-9 * max(1.0, abs(qs[p])), "numpy percentile cross-check"
    assert abs(np.std(arr, ddof=1) - sd) <= 1e-9 * sd
    cen = npv_one(central(case["revenue"]), central(case["rate"]), min(50.0, central(case["life"])), min(100.0, central(case["disc"])), case["growth"], case["tax"], case["cost"], case["timing"], case["straight"])
    return {
        "mean": mean, "sd": sd, "p10": qs[0.1], "p50": qs[0.5], "p90": qs[0.9],
        "negCount": neg, "central": cen, "capped": capped, "first": out[:5],
    }


# ---------------------------------------------------------------------------
# Deterministic valuation
# ---------------------------------------------------------------------------
def grid(life, timing):
    n = math.ceil(life - 1e-12)
    segs = []
    for k in range(1, n + 1):
        w = min(1.0, life - (k - 1))
        mid = k - 1 + w / 2
        tau = mid if timing == "mid" else k - 1 + w
        segs.append((k, w, mid, tau))
    return segs


def surv(mid, life, attr, decay):
    if attr == "none":
        return 1.0
    if attr == "straight":
        return 1 - mid / life
    return (1 - decay / 100) ** mid


def annuity(n, d, timing):
    return sum((1 + d / 100) ** -((j - 0.5) if timing == "mid" else j) for j in range(1, n + 1))


def rfr(case):
    r = case["royalty"] / 100
    t = case["tax"] / 100
    pvs = []
    after = []
    for k, w, mid, tau in grid(case["life"], case["timing"]):
        rev = case["revenue"][k - 1] * w
        roy = rev * surv(mid, case["life"], case["attr"], case["decay"]) * r
        at = roy - roy * t
        after.append(at)
        pvs.append(at * (1 + case["disc"] / 100) ** -tau)
    pv = sum(pvs)
    tf = None
    value = pv
    if case["tab"] > 0:
        n = case["tab"]
        tf = 1 / (1 - t * annuity(n, case["disc"], case["timing"]) / n)
        value = pv * tf
    if case["timing"] == "end" and float(case["life"]).is_integer() and case["attr"] == "none":
        assert abs(npf.npv(case["disc"] / 100, [0] + after) - pv) <= 1e-9 * abs(pv), "numpy-financial cross-check"
    return {"pvs": pvs, "pvSum": pv, "tabFactor": tf, "value": value}


def income(case):
    t = case["tax"] / 100 if case["preTax"] else 0.0
    pvs = []
    for k, w, mid, tau in grid(case["life"], case["timing"]):
        cf, cac = case["flows"][k - 1]
        ex = (cf - cac) * w
        at = ex - ex * t
        pvs.append(at * surv(mid, case["life"], case["attr"], case["decay"]) * (1 + case["disc"] / 100) ** -tau)
    return {"pvs": pvs, "value": sum(pvs)}


def comparable(case):
    m = case["ppy"]
    d = case["disc"] / 100
    dfs = [(1 + d) ** (-(k + 1) / m) for k in range(len(case["bases"]))]
    pv_base = sum(b * f for b, f in zip(case["bases"], dfs))
    if m == 1:
        assert abs(npf.npv(d, [0] + case["bases"]) - pv_base) <= 1e-9 * pv_base
    if case["direction"] == "lump2rate":
        rate = case["lump"] / pv_base * 100
        lump = case["lump"]
    else:
        rate = case["rate"]
        lump = case["rate"] / 100 * pv_base
    return {"pvBase": pv_base, "ratePct": rate, "lump": lump}


# ---------------------------------------------------------------------------
# Exact cents
# ---------------------------------------------------------------------------
def cents(fr):
    neg = fr < 0
    q, r = divmod(abs(fr.numerator) * 100, fr.denominator)
    if 2 * r >= fr.denominator:
        q += 1
    s = f"{q // 100:,}.{q % 100:02d}"
    return ("−$" if neg and q != 0 else "$") + s


def pct6(fr):
    """Percent to six decimals, half away from zero, trailing zeros trimmed down to two decimals."""
    q, r = divmod(abs(fr.numerator) * 10**6, fr.denominator)
    if 2 * r >= fr.denominator:
        q += 1
    s = f"{q // 10**6:,}.{q % 10**6:06d}"
    while len(s.split(".")[1]) > 2 and s.endswith("0"):
        s = s[:-1]
    return ("−" if fr < 0 and q != 0 else "") + s + "%"


def dec_half_up_check(fr, text):
    # an independent route for the cents: Decimal with ROUND_HALF_UP on the absolute value (60 digits of precision)
    from decimal import getcontext
    getcontext().prec = 80
    v = (Decimal(abs(fr.numerator)) / Decimal(fr.denominator)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    assert text.replace("−", "").replace("$", "").replace(",", "") == str(v), (text, v)


F = Fraction


def chain(case):
    base = F(case["revenue"]) if case["basis"] == "revenue" else F(case["units"]) * F(case["price"])
    shares = [F(case[k]) / 100 for k in ("ssu", "feature", "patent", "rate")]
    amts = [base]
    for s in shares:
        amts.append(amts[-1] * s)
    eff = shares[0] * shares[1] * shares[2] * F(case["rate"])
    cells = [cents(a) for a in amts]
    for a, c in zip(amts, cells):
        dec_half_up_check(a, c)
    return {"cells": cells, "royalty": cells[-1], "effective": pct6(eff)}


def emvr(case):
    emv, ss, r = F(case["emv"]), F(case["ssppu"]), F(case["rate"])
    return {
        "emvRoyalty": cents(emv * r / 100), "ssppuRoyalty": cents(ss * r / 100),
        "difference": cents(emv * r / 100 - ss * r / 100), "sharePct": pct6(ss / emv * 100), "equivalentPct": pct6(r * ss / emv),
    }


def nash(case):
    surplus = F(case["with"]) - F(case["alt"])
    pat = surplus * F(case["share"]) / 100
    return {"surplus": cents(surplus), "patentee": cents(pat), "licensee": cents(surplus - pat)}


# ---------------------------------------------------------------------------
# Cases (invented numbers)
# ---------------------------------------------------------------------------
FORECAST = [4_000_000, 4_600_000, 5_100_000, 5_400_000, 5_500_000, 5_300_000, 5_000_000, 4_600_000]
RFR_CASES = [
    dict(name="default block, mid, TAB 15", revenue=FORECAST, royalty=4, tax=21, disc=14, life=7.5, attr="none", decay=0, timing="mid", tab=15),
    dict(name="end-of-year, integer life, no TAB", revenue=FORECAST, royalty=5, tax=25, disc=12, life=8, attr="none", decay=0, timing="end", tab=0),
    dict(name="straight-line, end, TAB 10", revenue=FORECAST, royalty=3.5, tax=21, disc=16, life=6.25, attr="straight", decay=0, timing="end", tab=10),
    dict(name="decay 12%, mid, TAB 15", revenue=[1_000_000 * 1.05 ** k for k in range(20)], royalty=2.75, tax=30, disc=11.5, life=19.4, attr="decay", decay=12, timing="mid", tab=15),
    dict(name="zero discount, TAB 5", revenue=[750_000.0] * 5, royalty=10, tax=20, disc=0, life=5, attr="none", decay=0, timing="mid", tab=5),
    dict(name="short life 0.3 years", revenue=[2_000_000.0], royalty=6, tax=21, disc=20, life=0.3, attr="straight", decay=0, timing="mid", tab=0),
]
INCOME_CASES = [
    dict(name="default", flows=[[900000, 150000], [1150000, 180000], [1300000, 200000], [1350000, 210000], [1300000, 205000], [1150000, 190000]], preTax=True, tax=21, disc=15, life=6, attr="straight", decay=0, timing="mid"),
    dict(name="negative first year, after tax, decay, end", flows=[[-200000, 0], [400000, 50000], [800000, 90000], [900000, 100000], [850000, 95000]], preTax=False, tax=0, disc=13, life=4.6, attr="decay", decay=15, timing="end"),
    dict(name="no obsolescence, pre-tax", flows=[[500000, 0], [520000, 0], [540000, 0]], preTax=True, tax=35, disc=9, life=3, attr="none", decay=0, timing="end"),
]
MC_CASES = [
    dict(name="default-like", seed=20261027, samples=20000, revenue=["tri", [2500000, 4000000, 6000000]], rate=["tri", [2, 4, 6]], life=["tri", [4, 8, 12]], disc=["logn", [10, 18]], growth=3, tax=21, cost=600000, timing="mid", straight=False),
    dict(name="all lognormal, straight-line, end", seed=7, samples=20000, revenue=["logn", [1500000, 7000000]], rate=["logn", [1.5, 7]], life=["logn", [5, 14]], disc=["logn", [9, 20]], growth=-2, tax=25, cost=900000, timing="end", straight=True),
    dict(name="caps hit (wide lognormals)", seed=123456789, samples=5000, revenue=["logn", [1e6, 1e8]], rate=["logn", [5, 90]], life=["logn", [10, 49]], disc=["logn", [20, 95]], growth=0, tax=0, cost=0, timing="mid", straight=False),
    dict(name="fixed and degenerate triangular", seed=0, samples=3000, revenue=["fixed", [3000000]], rate=["tri", [4, 4, 4]], life=["tri", [6, 9, 9]], disc=["fixed", [12]], growth=4, tax=21, cost=1000000, timing="mid", straight=True),
]
CHAIN_CASES = [
    dict(name="default", basis="revenue", revenue="120000000", ssu="30", feature="40", patent="60", rate="5"),
    dict(name="units x price, awkward decimals", basis="unit", units="123457", price="249.99", ssu="17.5", feature="33.3333", patent="12.345", rate="2.75"),
    dict(name="half-cent cases", basis="revenue", revenue="1000.01", ssu="50", feature="50", patent="50", rate="50"),
    dict(name="small base", basis="revenue", revenue="0.07", ssu="99.99", feature="100", patent="0.01", rate="100"),
]
EMVR_CASES = [
    dict(name="default", emv="120000000", ssppu="18000000", rate="3"),
    dict(name="awkward", emv="98765432.10", ssppu="12345678.91", rate="1.375"),
]
NASH_CASES = [
    dict(name="default", **{"with": "9000000", "alt": "6500000", "share": "50"}),
    dict(name="odd cents", **{"with": "1234567.89", "alt": "-10000.01", "share": "33.3333"}),
]
COMPARABLE_CASES = [
    dict(name="lump to rate, annual", bases=[20e6, 24e6, 27e6, 28e6, 26e6], direction="lump2rate", lump=2_500_000, rate=0, disc=10, ppy=1),
    dict(name="rate to lump, quarterly", bases=[5e6, 5.5e6, 6e6, 6.2e6, 6.1e6, 6.0e6, 5.8e6, 5.5e6], direction="rate2lump", lump=0, rate=3.25, disc=9, ppy=4),
]


def main():
    out = {
        "_source": "scripts/ipval-oracle.py (numpy " + np.__version__ + ", numpy-financial, fractions)",
        "rfr": [dict(c, expect=rfr(c)) for c in RFR_CASES],
        "income": [dict(c, expect=income(c)) for c in INCOME_CASES],
        "mc": [dict(c, expect=monte_carlo(c)) for c in MC_CASES],
        "chain": [dict(c, expect=chain(c)) for c in CHAIN_CASES],
        "emvr": [dict(c, expect=emvr(c)) for c in EMVR_CASES],
        "nash": [dict(c, expect=nash(c)) for c in NASH_CASES],
        "comparable": [dict(c, expect=comparable(c)) for c in COMPARABLE_CASES],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print("wrote", os.path.normpath(OUT))


if __name__ == "__main__":
    main()
