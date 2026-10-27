"""
Oracle for Release F2 litigation damages (gap items #6 and #20): writes src/lib/__tests__/fixtures/litig-oracle.json.

Run: ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/litig-oracle.py

Independent re-implementations, written from the stated conventions, NOT from the TypeScript:
  - inflation ribbon (constant dollar = -AR x prior close summed over later disclosures; constant percentage =
    close x (1 - prod(1 + AR) over later disclosures)), day by day with datetime.date;
  - FIFO / LIFO matching by expanding every lot into a deque of (lot, shares) and popping from the chosen end;
  - the PSLRA 90-day mean: closes on calendar days D .. D + 89 (datetime.timedelta), plain mean; (e)(2) through the
    sale date;
  - the proportional trading model as an O(n^2) simulation that tracks every day's purchase block separately
    (the engine keeps one running holding per window, O(n x windows));
  - statsmodels OLS for the dummy-variable and forecast regressions (classical, HC1, HAC with Stata's correction)
    and the pass-through slope.
Random cases use numpy's default_rng with the seed printed in the fixture.
"""
import datetime as dt
import json
import math
import os
from collections import deque

import numpy as np
import statsmodels.api as sm

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "lib", "__tests__", "fixtures", "litig-oracle.json")
SEED = 20261027
rng = np.random.default_rng(SEED)


def d(s):
    return dt.date.fromisoformat(s)


def weekdays(a, b):
    out, x = [], a
    while x <= b:
        if x.weekday() < 5:
            out.append(x)
        x += dt.timedelta(1)
    return out


# ---------------------------------------------------------------------------------------------------------------
# Ribbon
# ---------------------------------------------------------------------------------------------------------------
def ribbon(days, close, disc, ar):
    idx = {x: i for i, x in enumerate(days)}
    drops = [-a * close[idx[x] - 1] for x, a in zip(disc, ar)]
    dollar, pct = [], []
    for i, t in enumerate(days):
        later = [j for j, x in enumerate(disc) if x > t]
        dollar.append(sum(drops[j] for j in later))
        f = 1.0
        for j in later:
            f *= 1 + ar[j]
        pct.append(close[i] * (1 - f))
    return drops, dollar, pct


RIBBON_DEFAULT = [
    ("2025-03-03", 41.82), ("2025-03-04", 41.47), ("2025-03-05", 41.62), ("2025-03-06", 41.20), ("2025-03-07", 41.23),
    ("2025-03-10", 41.10), ("2025-03-11", 40.66), ("2025-03-12", 40.67), ("2025-03-13", 40.22), ("2025-03-14", 40.15),
    ("2025-03-17", 37.54), ("2025-03-18", 37.16), ("2025-03-19", 36.79), ("2025-03-20", 36.72), ("2025-03-21", 37.01),
    ("2025-03-24", 36.68), ("2025-03-25", 36.43), ("2025-03-26", 36.55), ("2025-03-27", 36.94), ("2025-03-28", 37.01),
    ("2025-03-31", 33.49), ("2025-04-01", 33.41), ("2025-04-02", 33.79), ("2025-04-03", 33.42), ("2025-04-04", 33.71),
]


def ribbon_case(name, rows, disc, ar):
    days = [d(a) for a, _ in rows]
    close = [b for _, b in rows]
    dd = [d(x) for x in disc]
    drops, dollar, pct = ribbon(days, close, dd, ar)
    return {"name": name, "days": [a for a, _ in rows], "close": close, "disc": disc, "ar": ar, "drops": drops, "dollar": dollar, "pct": pct}


ribbons = [ribbon_case("default", RIBBON_DEFAULT, ["2025-03-17", "2025-03-31"], [-0.062, -0.093])]
rd = weekdays(d("2023-01-02"), d("2024-03-29"))
p, rows = 60.0, []
for x in rd:
    p *= 1 + rng.normal(0, 0.015)
    rows.append((x.isoformat(), round(p, 2)))
rdisc_idx = sorted(rng.choice(np.arange(20, len(rows) - 5), size=4, replace=False).tolist())
ribbons.append(ribbon_case("random 4 disclosures", rows, [rows[i][0] for i in rdisc_idx], [round(float(-rng.uniform(0.02, 0.2)), 4) for _ in rdisc_idx]))

# ---------------------------------------------------------------------------------------------------------------
# FIFO / LIFO
# ---------------------------------------------------------------------------------------------------------------


def match(trades, opening, method):
    """trades: list of (date, side, shares, price, row) in date order. Returns [(buy_row, buy_date|None, sell_date|None, shares)]."""
    lots = deque()
    if opening > 0:
        lots.append([0, None, opening])
    out = []
    for (day, side, sh, _price, row) in trades:
        if side == "buy":
            lots.append([row, day, sh])
            continue
        need = sh
        while need > 1e-12:
            lot = lots[0] if method == "fifo" else lots[-1]
            take = min(need, lot[2])
            out.append((lot[0], lot[1], day, take))
            lot[2] -= take
            need -= take
            if lot[2] <= 1e-12:
                if method == "fifo":
                    lots.popleft()
                else:
                    lots.pop()
    for lot in lots:
        if lot[2] > 1e-12:
            out.append((lot[0], lot[1], None, lot[2]))
    return out


def window(day, disc):
    return sum(1 for x in disc if x <= day)


def half_up_cents(x):
    # Half away from zero at the cent, on the decimal value of the float (cases avoid exact halves).
    from decimal import Decimal, ROUND_HALF_UP
    return float(Decimal(repr(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def oop(start, disc, drops, trades, opening, method):
    disc_d = [d(x) for x in disc]
    k = len(disc)
    infl = [sum(drops[w:]) for w in range(k + 1)]
    st = d(start)
    ms = match(trades, opening, method)
    total = 0.0
    lots = []
    for (row, bday, sday, sh) in ms:
        if bday is None or bday < st or window(bday, disc_d) == k:
            loss = 0.0
        else:
            wb = window(bday, disc_d)
            ws = k if sday is None else window(sday, disc_d)
            loss = half_up_cents((infl[wb] - infl[ws]) * sh)
        total += loss
        lots.append({"buyRow": row, "sell": None if sday is None else sday.isoformat(), "shares": sh, "loss": loss})
    class_end = disc_d[-1] - dt.timedelta(1)
    held = opening + sum((sh if side == "buy" else -sh) for (day, side, sh, _p, _r) in trades if day <= class_end)
    return {"total": round(total, 2), "held": held, "lots": lots}


DEFAULT_BLOTTER = [("2025-02-20", "buy", 300, 40.10), ("2025-03-05", "buy", 1000, 41.20), ("2025-03-10", "buy", 500, 41.80), ("2025-03-20", "sell", 600, 36.90), ("2025-03-25", "buy", 400, 36.40), ("2025-04-02", "sell", 700, 33.75)]
DROPS = [2.4893, 3.4419]


def blot(rows):
    return [(d(a), s, sh, pr, i + 1) for i, (a, s, sh, pr) in enumerate(rows)]


oops = []
for m in ("fifo", "lifo"):
    oops.append({"name": f"default {m}", "start": "2025-03-03", "disc": ["2025-03-17", "2025-03-31"], "drops": DROPS, "blotter": DEFAULT_BLOTTER, "opening": 200, "method": m,
                 **oop("2025-03-03", ["2025-03-17", "2025-03-31"], DROPS, blot(DEFAULT_BLOTTER), 200, m)})
# Random blotter: 60 trades over 2023-2024, 3 disclosures, never short.
bd = weekdays(d("2023-01-02"), d("2024-06-28"))
picks = sorted(rng.choice(len(bd), size=60, replace=False).tolist())
pos, rb = 500, []
for i in picks:
    if pos > 0 and rng.random() < 0.45:
        sh = int(rng.integers(1, pos + 1))
        pos -= sh
        rb.append((bd[i].isoformat(), "sell", sh, round(float(rng.uniform(20, 80)), 2)))
    else:
        sh = int(rng.integers(10, 2000))
        pos += sh
        rb.append((bd[i].isoformat(), "buy", sh, round(float(rng.uniform(20, 80)), 2)))
rdisc = ["2023-06-15", "2023-11-02", "2024-03-12"]
rdrops = [1.37, 2.215, 0.9031]
for m in ("fifo", "lifo"):
    oops.append({"name": f"random {m}", "start": "2023-02-01", "disc": rdisc, "drops": rdrops, "blotter": rb, "opening": 500, "method": m,
                 **oop("2023-02-01", rdisc, rdrops, blot(rb), 500, m)})

# ---------------------------------------------------------------------------------------------------------------
# PSLRA 90-day mean
# ---------------------------------------------------------------------------------------------------------------
LOOKBACK = "2025-03-31 35.19|2025-04-01 34.82|2025-04-02 34.42|2025-04-03 34.23|2025-04-04 34.59|2025-04-07 34.26|2025-04-08 34.37|2025-04-09 34.53|2025-04-10 34.41|2025-04-11 34.48|2025-04-14 34.03|2025-04-15 33.58|2025-04-16 33.29|2025-04-17 33.50|2025-04-21 33.44|2025-04-22 33.26|2025-04-23 33.37|2025-04-24 33.33|2025-04-25 33.14|2025-04-28 33.46|2025-04-29 33.69|2025-04-30 33.44|2025-05-01 33.53|2025-05-02 33.57|2025-05-05 33.98|2025-05-06 34.24|2025-05-07 34.03|2025-05-08 34.55|2025-05-09 34.16|2025-05-12 34.09|2025-05-13 34.38|2025-05-14 34.03|2025-05-15 34.03|2025-05-16 33.56|2025-05-19 33.76|2025-05-20 34.05|2025-05-21 34.14|2025-05-22 34.56|2025-05-23 34.38|2025-05-27 34.60|2025-05-28 34.72|2025-05-29 34.82|2025-05-30 34.79|2025-06-02 35.18|2025-06-03 35.68|2025-06-04 35.67|2025-06-05 35.87|2025-06-06 35.40|2025-06-09 35.64|2025-06-10 35.82|2025-06-11 36.38|2025-06-12 36.76|2025-06-13 36.54|2025-06-16 36.43|2025-06-17 36.63|2025-06-18 36.11|2025-06-20 36.09|2025-06-23 35.73|2025-06-24 35.33|2025-06-25 34.86|2025-06-26 35.17|2025-06-27 34.78|2025-06-30 34.53"
lb_rows = [(a.split()[0], float(a.split()[1])) for a in LOOKBACK.split("|")]


def lookback(rows, disclosure, sale=None):
    D = d(disclosure)
    end = D + dt.timedelta(89)
    inside = [(d(a), c) for a, c in rows if D <= d(a) <= end]
    m90 = sum(c for _, c in inside) / len(inside)
    ms = None
    if sale is not None:
        S = d(sale)
        upto = [c for x, c in inside if x <= S]
        ms = sum(upto) / len(upto)
    return {"end": end.isoformat(), "n": len(inside), "mean90": m90, "meanSale": ms}


lookbacks = [
    {"name": "default held", "rows": lb_rows, "disclosure": "2025-03-31", "sale": None, **lookback(lb_rows, "2025-03-31")},
    {"name": "default sold 2025-05-09", "rows": lb_rows, "disclosure": "2025-03-31", "sale": "2025-05-09", **lookback(lb_rows, "2025-03-31", "2025-05-09")},
    # A sale on a Sunday: the closes through the Friday before.
    {"name": "default sold Sunday 2025-04-13", "rows": lb_rows, "disclosure": "2025-03-31", "sale": "2025-04-13", **lookback(lb_rows, "2025-03-31", "2025-04-13")},
    # A disclosure mid-series: the closes before it are not used.
    {"name": "disclosure 2025-04-02", "rows": lb_rows, "disclosure": "2025-04-02", "sale": None, **lookback(lb_rows, "2025-04-02")},
]

# ---------------------------------------------------------------------------------------------------------------
# Trading model: every purchase block tracked separately
# ---------------------------------------------------------------------------------------------------------------


def trading_blocks(days, vol, disc, drops, F):
    k = len(disc)
    infl = [sum(drops[w:]) for w in range(k + 1)]
    blocks = []  # [window, shares]
    dmg = [0.0] * k
    for day, v in zip(days, vol):
        c = window(day, disc)
        if c >= k:
            continue
        t = v / F
        for b in blocks:
            sold = b[1] * t
            b[1] -= sold
            dmg[b[0]] -= sold * infl[c]
        blocks.append([c, v])
        dmg[c] += v * infl[c]
    return dmg, sum(b[1] for b in blocks)


VOLUME = "2025-03-03 2401000|2025-03-04 2833000|2025-03-05 1130000|2025-03-06 1481000|2025-03-07 2639000|2025-03-10 2445000|2025-03-11 3050000|2025-03-12 1938000|2025-03-13 1360000|2025-03-14 2563000|2025-03-17 3053000|2025-03-18 1940000|2025-03-19 2501000|2025-03-20 2269000|2025-03-21 2358000|2025-03-24 1745000|2025-03-25 1418000|2025-03-26 1139000|2025-03-27 1521000|2025-03-28 1419000|2025-03-31 1750000|2025-04-01 1755000"
vrows = [(a.split()[0], float(a.split()[1])) for a in VOLUME.split("|")]


def trading_case(name, rows, start, disc, drops, F, red, aF, aV):
    st = d(start)
    dd = [d(x) for x in disc]
    end = dd[-1] - dt.timedelta(1)
    use = [(d(a), v * (1 - red)) for a, v in rows if st <= d(a) <= end]
    days = [a for a, _ in use]
    vol = [v for _, v in use]
    one, r1 = trading_blocks(days, vol, dd, drops, F)
    A, rA = trading_blocks(days, [v * aV for v in vol], dd, drops, F * aF)
    P, rP = trading_blocks(days, [v * (1 - aV) for v in vol], dd, drops, F * (1 - aF))
    return {"name": name, "rows": rows, "start": start, "disc": disc, "drops": drops, "float": F, "reduction": red, "activeFloat": aF, "activeVolume": aV,
            "one": one, "oneRetained": r1, "two": [a + b for a, b in zip(A, P)], "twoRetained": rA + rP}


tradings = [trading_case("default", vrows, "2025-03-03", ["2025-03-17", "2025-03-31"], DROPS, 50e6, 0.0, 0.2, 0.8)]
td = weekdays(d("2022-01-03"), d("2023-12-29"))
trows = [(x.isoformat(), float(int(rng.integers(200_000, 4_000_000)))) for x in td]
tradings.append(trading_case("random 2 years, 50% reduction", trows, "2022-02-01", ["2022-07-14", "2023-01-10", "2023-09-21"], [0.85, 1.6, 2.35], 120e6, 0.5, 0.25, 0.7))

# ---------------------------------------------------------------------------------------------------------------
# Antitrust regressions (statsmodels)
# ---------------------------------------------------------------------------------------------------------------
AT = "2019-01 before 97.13 49.05 185.1|2019-02 before 101.42 49.88 202.0|2019-03 before 102.28 51.56 200.5|2019-04 before 102.15 51.90 186.6|2019-05 before 105.32 52.72 211.2|2019-06 before 100.38 51.57 197.0|2019-07 before 100.89 52.94 186.9|2019-08 before 100.47 51.64 189.9|2019-09 before 99.14 51.41 185.0|2019-10 before 100.55 52.01 195.9|2019-11 before 105.81 55.50 203.4|2019-12 before 103.21 53.41 195.4|2020-01 during 116.14 53.29 210.5|2020-02 during 114.13 55.06 199.5|2020-03 during 112.93 54.01 195.3|2020-04 during 115.78 57.32 189.8|2020-05 during 118.54 58.20 200.8|2020-06 during 116.67 56.97 185.8|2020-07 during 122.82 59.11 210.9|2020-08 during 116.08 56.64 196.0|2020-09 during 122.01 59.09 201.0|2020-10 during 119.30 57.72 191.7|2020-11 during 125.34 60.74 210.6|2020-12 during 122.47 60.47 207.2|2021-01 after 109.60 59.67 195.7|2021-02 after 108.28 58.11 193.4|2021-03 after 114.59 61.17 213.7|2021-04 after 118.11 62.55 214.6|2021-05 after 111.03 60.66 191.6|2021-06 after 111.99 60.39 191.1"
at = [a.split() for a in AT.split("|")]
labels = [r[0] for r in at]
kinds = [r[1] for r in at]
price = np.array([float(r[2]) for r in at])
cost = np.array([float(r[3]) for r in at])
demand = np.array([float(r[4]) for r in at])


def hac_default(n):
    return int(math.floor(4 * (n / 100) ** (2 / 9)))


def fit(y, X, cov):
    m = sm.OLS(y, X)
    if cov == "classical":
        return m.fit()
    if cov == "hc1":
        return m.fit(cov_type="HC1", use_t=True)
    return m.fit(cov_type="HAC", use_t=True, cov_kwds={"maxlags": hac_default(len(y)), "use_correction": True})


def rates(p, bf):
    diff = p.sum() - bf.sum()
    return {"perUnit": diff / len(p), "pctOfButFor": diff / bf.sum(), "shareOfActual": diff / p.sum()}


regs = []
D = np.array([1.0 if k == "during" else 0.0 for k in kinds])
during = np.array([k == "during" for k in kinds])
before = np.array([k == "before" for k in kinds])
for form in ("log", "level"):
    y = np.log(price) if form == "log" else price
    for cov in ("classical", "hc1", "hac"):
        X = np.column_stack([cost, demand, D, np.ones(len(y))])
        r = fit(y, X, cov)
        delta = float(r.params[2])
        bf = price[during] * math.exp(-delta) if form == "log" else price[during] - delta
        ci = np.asarray(r.conf_int())
        Xb = np.column_stack([cost[before], demand[before], np.ones(before.sum())])
        rf = fit(y[before], Xb, cov)
        yh = np.column_stack([cost[during], demand[during], np.ones(during.sum())]) @ rf.params
        bff = np.exp(yh) if form == "log" else yh
        regs.append({
            "form": form, "cov": cov,
            "dummy": {"params": list(map(float, r.params)), "bse": list(map(float, r.bse)), "pvalues": list(map(float, r.pvalues)), "ciLo": list(map(float, ci[:, 0])), "ciHi": list(map(float, ci[:, 1])), "butFor": list(map(float, bf)), **rates(price[during], bf)},
            "forecast": {"params": list(map(float, rf.params)), "bse": list(map(float, rf.bse)), "butFor": list(map(float, bff)), **rates(price[during], bff)},
        })
# Forecast with no controls: the before-period mean (statsmodels on a constant alone).
r0 = sm.OLS(price[before], np.ones(before.sum())).fit()
regs_noctl = {"butFor": float(r0.params[0]), **rates(price[during], np.full(during.sum(), float(r0.params[0])))}

PT = [(100.94, 131.20), (102.62, 132.65), (100.17, 130.48), (104.16, 134.01), (114.40, 139.95), (116.99, 141.82), (120.30, 143.47), (122.37, 145.36)]
rp = sm.OLS(np.array([b for _, b in PT]), sm.add_constant(np.array([a for a, _ in PT]))).fit()
passthrough = {"rate": float(rp.params[1]), "se": float(rp.bse[1]), "n": len(PT)}

json.dump({
    "seed": SEED,
    "ribbons": ribbons,
    "oop": oops,
    "lookbacks": lookbacks,
    "trading": tradings,
    "antitrust": {"labels": labels, "kinds": kinds, "price": price.tolist(), "cost": cost.tolist(), "demand": demand.tolist(), "hacLag": hac_default(len(price)), "regs": regs, "forecastNoControls": regs_noctl},
    "passthrough": passthrough,
}, open(OUT, "w", encoding="utf8"), indent=1)
print("wrote", OUT)
