"""Oracle for release F1 derivatives (src/lib/finance.ts Merton q, src/lib/derivatives.ts).

Run:  ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/deriv-oracle.py
Writes src/lib/__tests__/fixtures/deriv-oracle.json (QuantLib 1.44, numpy, scipy).

Sources, by item:
  Black-Scholes-Merton (q)  QuantLib AnalyticEuropeanEngine on a BlackScholesMertonProcess with FlatForward
                            Actual365Fixed Continuous curves for r and q; expiry = evaluation date + D days, t = D/365
                            exactly. NPV, delta, gamma, vega, theta (per year), rho, dividendRho. Implied volatility by
                            VanillaOption.impliedVolatility (accuracy 1e-12).
  Black-76                  price by QuantLib blackFormula(type, K, F, sigma*sqrt(t), e^(-rt)); Greeks from
                            AnalyticEuropeanEngine with S = F and q = r (the futures price as an asset with yield r),
                            Black-76 rho with F fixed = QuantLib rho + dividendRho. Every Greek is also checked here
                            against a central finite difference of blackFormula with F held fixed (asserted to 1e-5).
  CRR binomial              an independent numpy implementation of the PINNED convention u = e^(sigma sqrt(dt)),
                            d = 1/u, p = (e^((r-q)dt) - d)/(u - d), discount e^(-r dt), American exercise at every node
                            including today; Hull's tree Greeks (delta from step 1, gamma and theta from step 2).
                            QuantLib's BinomialVanillaEngine "crr" uses p = 1/2 + 1/2 (r - q - sigma^2/2) dt / dx, a
                            different p, so it is recorded at n = 2000 only as a convergence cross-check (with the
                            analytic European price), never as an exact match.
  Parity, cost of carry     closed forms evaluated here in Python floats.
  Strategy payoff           brute force: profit on a 1e-3 grid over [0, 3 x max strike] with scipy brentq on every sign
                            change; max/min over the grid and the kinks; the slope past the last strike from two far
                            points.
  Swap                      QuantLib VanillaSwap (Payer/Receiver) with Schedule on the 15th of each month (NullCalendar,
                            Unadjusted, Backward), Thirty360 BondBasis for both legs, the index and the curve, so every
                            accrual is months/12 exactly; DiscountCurve (log-linear in the discount factor) on the user
                            points; IborIndex with 0 fixing days on the same curve; DiscountingSwapEngine. The script
                            asserts QuantLib's NPV equals the closed form annuity / (1 - D(T)) result to 1e-10.
"""
import json
import math
import os

import numpy as np
import QuantLib as ql
from scipy.optimize import brentq

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "lib", "__tests__", "fixtures", "deriv-oracle.json")

TODAY = ql.Date(15, 1, 2026)
ql.Settings.instance().evaluationDate = TODAY
DC = ql.Actual365Fixed()


def process(S, r, q, sig):
    return ql.BlackScholesMertonProcess(
        ql.QuoteHandle(ql.SimpleQuote(S)),
        ql.YieldTermStructureHandle(ql.FlatForward(TODAY, q, DC, ql.Continuous)),
        ql.YieldTermStructureHandle(ql.FlatForward(TODAY, r, DC, ql.Continuous)),
        ql.BlackVolTermStructureHandle(ql.BlackConstantVol(TODAY, ql.NullCalendar(), sig, DC)),
    )


def option(typ, K, days, american=False):
    pay = ql.PlainVanillaPayoff(ql.Option.Call if typ == "call" else ql.Option.Put, K)
    ex = ql.AmericanExercise(TODAY, TODAY + days) if american else ql.EuropeanExercise(TODAY + days)
    return ql.VanillaOption(pay, ex)


# ---------------------------------------------------------------------------------------------------------------
# Black-Scholes-Merton with q
# ---------------------------------------------------------------------------------------------------------------
BSM_CASES = [
    # type, S, K, days, r, q, sigma, note
    ("call", 100, 100, 365, 0.05, 0.0, 0.20, "D1 ATM (gap analysis)"),
    ("call", 100, 150, 365, 0.05, 0.0, 0.20, "D1 K = 150"),
    ("call", 100, 200, 365, 0.05, 0.0, 0.20, "D1 K = 200"),
    ("put", 100, 60, 365, 0.05, 0.0, 0.20, "D1 put K = 60"),
    ("call", 100, 100, 365, 0.05, 0.03, 0.20, "Merton q = 3%"),
    ("put", 100, 100, 365, 0.05, 0.03, 0.20, "Merton put q = 3%"),
    ("call", 50, 55, 182, 0.02, 0.06, 0.35, "q > r"),
    ("put", 50, 45, 730, -0.005, 0.01, 0.25, "negative rate"),
    ("call", 100, 40, 365, 0.05, 0.02, 0.20, "deep ITM call"),
    ("put", 40, 100, 730, 0.08, 0.0, 0.20, "deep ITM put"),
    ("call", 100, 160, 91, 0.03, 0.01, 0.15, "deep OTM call"),
    ("put", 1250, 1300, 1095, 0.04, 0.015, 0.18, "index put, 3 years"),
]

bsm = []
for typ, S, K, days, r, q, sig, note in BSM_CASES:
    o = option(typ, K, days)
    p = process(S, r, q, sig)
    o.setPricingEngine(ql.AnalyticEuropeanEngine(p))
    rec = dict(type=typ, S=S, K=K, t=days / 365, r=r, q=q, sigma=sig, note=note, price=o.NPV(), delta=o.delta(),
               gamma=o.gamma(), vega=o.vega(), theta=o.theta(), rho=o.rho(), psi=o.dividendRho())
    rec["iv"] = o.impliedVolatility(o.NPV(), p, 1e-12, 1000, 1e-4, 5.0) if o.NPV() > 1e-6 else None
    bsm.append(rec)

# ---------------------------------------------------------------------------------------------------------------
# Black-76
# ---------------------------------------------------------------------------------------------------------------
B76_CASES = [
    ("call", 100, 100, 365, 0.05, 0.20, "ATM"),
    ("put", 100, 100, 365, 0.05, 0.20, "ATM put"),
    ("call", 620, 600, 146, 0.04, 0.30, "commodity call, 0.4 years"),
    ("put", 2.85, 3.10, 73, 0.03, 0.45, "gas put"),
    ("call", 98.5, 110, 730, -0.004, 0.12, "negative rate OTM"),
    ("put", 150, 90, 365, 0.02, 0.25, "deep OTM put"),
]


def black(typ, F, K, t, r, sig):
    return ql.blackFormula(ql.Option.Call if typ == "call" else ql.Option.Put, K, F, sig * math.sqrt(t), math.exp(-r * t))


b76 = []
for typ, F, K, days, r, sig, note in B76_CASES:
    t = days / 365
    price = black(typ, F, K, t, r, sig)
    o = option(typ, K, days)
    o.setPricingEngine(ql.AnalyticEuropeanEngine(process(F, r, r, sig)))
    rec = dict(type=typ, F=F, K=K, t=t, r=r, sigma=sig, note=note, price=price, delta=o.delta(), gamma=o.gamma(),
               vega=o.vega(), theta=o.theta(), rho=o.rho() + o.dividendRho())
    assert abs(o.NPV() - price) < 1e-10 * max(1, price), (note, o.NPV(), price)
    h = 1e-4
    fd = dict(
        delta=(black(typ, F * (1 + h), K, t, r, sig) - black(typ, F * (1 - h), K, t, r, sig)) / (2 * F * h),
        gamma=(black(typ, F * (1 + h), K, t, r, sig) - 2 * price + black(typ, F * (1 - h), K, t, r, sig)) / (F * h) ** 2,
        vega=(black(typ, F, K, t, r, sig + h) - black(typ, F, K, t, r, sig - h)) / (2 * h),
        theta=-(black(typ, F, K, t + h, r, sig) - black(typ, F, K, t - h, r, sig)) / (2 * h),
        rho=(black(typ, F, K, t, r + h, sig) - black(typ, F, K, t, r - h, sig)) / (2 * h),
    )
    for k, v in fd.items():
        assert abs(v - rec[k]) < 1e-5 * max(1, abs(v)), (note, k, v, rec[k])
    b76.append(rec)

# ---------------------------------------------------------------------------------------------------------------
# CRR (pinned convention, numpy)
# ---------------------------------------------------------------------------------------------------------------


def crr(typ, american, S, K, t, r, q, sig, n):
    dt = t / n
    sd = sig * math.sqrt(dt)
    u = math.exp(sd)
    d = 1 / u
    p = (math.exp((r - q) * dt) - d) / (u - d)
    disc = math.exp(-r * dt)
    sign = 1 if typ == "call" else -1
    j = np.arange(n + 1)
    v = np.maximum(sign * (S * np.exp((2 * j - n) * sd) - K), 0.0)
    levels = {n: v.copy()}
    early = 0
    for i in range(n - 1, -1, -1):
        cont = disc * (p * v[1:i + 2] + (1 - p) * v[0:i + 1])
        if american:
            ex = sign * (S * np.exp((2 * np.arange(i + 1) - i) * sd) - K)
            better = ex > cont + 1e-12 * max(1, K)
            early += int(better.sum())
            v = np.where(better, ex, cont)
        else:
            v = cont
        if i <= 2:
            levels[i] = v.copy()
    out = dict(price=float(v[0]), u=u, d=d, p=p, earlyNodes=early)
    if n >= 2:
        f1 = levels[1]
        f2 = levels[2]
        out["delta"] = float((f1[1] - f1[0]) / (S * u - S * d))
        out["gamma"] = float(((f2[2] - f2[1]) / (S * u * u - S) - (f2[1] - f2[0]) / (S - S * d * d)) / (0.5 * (S * u * u - S * d * d)))
        out["theta"] = float((f2[1] - v[0]) / (2 * dt))
    return out


CRR_CASES = [
    # type, american, S, K, days(t=days/365), r, q, sigma, n, note
    ("put", True, 50, 50, None, 0.10, 0.0, 0.40, 5, "Hull: American put S = K = 50, r = 10%, sigma = 40%, 5 months, 5 steps (textbook 4.49)"),
    ("put", False, 50, 50, None, 0.10, 0.0, 0.40, 5, "same, European"),
    ("call", False, 100, 100, 365, 0.05, 0.0, 0.20, 1, "n = 1"),
    ("call", True, 100, 100, 365, 0.05, 0.0, 0.20, 3, "American call no dividend = European"),
    ("call", True, 100, 95, 365, 0.03, 0.08, 0.25, 50, "American call, q > r (early exercise)"),
    ("put", True, 100, 110, 730, 0.06, 0.0, 0.30, 200, "American put 200 steps"),
    ("put", True, 100, 100, 365, -0.01, 0.0, 0.20, 100, "negative rate American put"),
    ("call", False, 100, 100, 365, 0.05, 0.02, 0.20, 1000, "European 1000 steps"),
]
crr_out = []
for typ, am, S, K, days, r, q, sig, n, note in CRR_CASES:
    t = 5 / 12 if days is None else days / 365
    rec = dict(type=typ, american=am, S=S, K=K, t=t, r=r, q=q, sigma=sig, n=n, note=note, **crr(typ, am, S, K, t, r, q, sig, n))
    crr_out.append(rec)
assert abs(crr_out[0]["price"] - 4.49) < 0.005, crr_out[0]["price"]

# Convergence cross-check: pinned CRR at n = 2000 vs QuantLib "crr" at 2000 vs analytic (European).
CONV = [
    ("call", False, 100, 100, 365, 0.05, 0.02, 0.20),
    ("put", True, 100, 110, 730, 0.06, 0.0, 0.30),
    ("put", True, 40, 40, 182, 0.04, 0.0, 0.35),
]
conv = []
for typ, am, S, K, days, r, q, sig in CONV:
    o = option(typ, K, days, am)
    p = process(S, r, q, sig)
    o.setPricingEngine(ql.BinomialVanillaEngine(p, "crr", 2000))
    qlv = o.NPV()
    eo = option(typ, K, days)
    eo.setPricingEngine(ql.AnalyticEuropeanEngine(p))
    conv.append(dict(type=typ, american=am, S=S, K=K, t=days / 365, r=r, q=q, sigma=sig, n=2000,
                     pinned=crr(typ, am, S, K, days / 365, r, q, sig, 2000)["price"], quantlibCrr=qlv, analyticEuropean=eo.NPV()))

# ---------------------------------------------------------------------------------------------------------------
# Parity and carry
# ---------------------------------------------------------------------------------------------------------------
PARITY = [(10.45, 5.57, 100, 100, 1.0, 0.05, 0.0), (7.2, 9.1, 98, 100, 0.5, 0.04, 0.02), (3.0, 3.0, 50, 50, 0.25, 0.0, 0.0)]
parity = []
for C, P, S, K, t, r, q in PARITY:
    rhs = S * math.exp(-q * t) - K * math.exp(-r * t)
    parity.append(dict(C=C, P=P, S=S, K=K, t=t, r=r, q=q, lhs=C - P, rhs=rhs, violation=C - P - rhs, impliedForward=K + (C - P) * math.exp(r * t)))

CARRY = [(100, 0.5, 0.05, 0.0, 0.0, 0.0, 0.0), (1800, 0.75, 0.04, 0.0, 0.002, 0.0, 12.0), (950, 1.0, 0.05, 0.0, 0.0, 39.35, 0.0), (4200, 0.25, 0.03, 0.015, 0.0, 0.0, 0.0)]
carry = []
for S, t, r, q, u, I, U in CARRY:
    carry.append(dict(S=S, t=t, r=r, q=q, u=u, I=I, U=U, F=(S - I + U) * math.exp((r - q + u) * t)))

# ---------------------------------------------------------------------------------------------------------------
# Strategy payoff (brute force)
# ---------------------------------------------------------------------------------------------------------------
STRATS = [
    ("iron condor", [("put", 90, 1, 1.2), ("put", 95, -1, 2.5), ("call", 105, -1, 2.6), ("call", 110, 1, 1.1)], 1),
    ("long straddle", [("call", 100, 1, 6.0), ("put", 100, 1, 5.5)], 100),
    ("covered call", [("stock", 48, 1, 0.0), ("call", 55, -1, 1.75)], 100),
    ("bull call spread", [("call", 40, 1, 4.1), ("call", 45, -1, 1.6)], 1),
    ("short put", [("put", 30, -2, 1.25)], 1),
    ("butterfly", [("call", 90, 1, 12.0), ("call", 100, -2, 5.0), ("call", 110, 1, 1.5)], 1),
]
strat = []
for name, legs, mult in STRATS:
    def prof(s, legs=legs, mult=mult):
        tot = 0.0
        for k, K, qty, prem in legs:
            pay = max(s - K, 0) if k == "call" else max(K - s, 0) if k == "put" else s - K
            tot += qty * (pay - prem)
        return tot * mult
    hi = 3 * max(K for _, K, _, _ in legs)
    xs = np.linspace(0, hi, int(hi / 1e-3) + 1)
    ys = np.array([prof(x) for x in xs])
    roots = []
    for i in range(len(xs) - 1):
        if ys[i] == 0:
            roots.append(float(xs[i]))
        elif ys[i] * ys[i + 1] < 0:
            roots.append(float(brentq(prof, xs[i], xs[i + 1], xtol=1e-12)))
    slope = (prof(10 * hi) - prof(5 * hi)) / (5 * hi)
    kinks = [0.0] + [K for k, K, _, _ in legs if k != "stock"]
    cand = list(ys) + [prof(k) for k in kinks]
    strat.append(dict(name=name, legs=[dict(kind=k, strike=K, qty=qty, premium=prem) for k, K, qty, prem in legs], mult=mult,
                      breakevens=roots, slopeHigh=slope, maxProfit=None if slope > 1e-9 else max(cand), maxLoss=None if slope < -1e-9 else min(cand),
                      netPremium=sum(qty * prem for _, _, qty, prem in legs) * mult))

# ---------------------------------------------------------------------------------------------------------------
# Swap
# ---------------------------------------------------------------------------------------------------------------
TH = ql.Thirty360(ql.Thirty360.BondBasis)
FREQ = {1: ql.Annual, 2: ql.Semiannual, 4: ql.Quarterly, 12: ql.Monthly}
PERIOD = {1: ql.Period(1, ql.Years), 2: ql.Period(6, ql.Months), 4: ql.Period(3, ql.Months), 12: ql.Period(1, ql.Months)}

CURVE_A = [(0.5, 0.98), (1, 0.9605), (2, 0.9210), (3, 0.8820), (5, 0.8050), (7, 0.7330), (10, 0.6400)]
CURVE_NEG = [(0.25, 1.0012), (1, 1.0035), (2, 1.0040), (5, 0.9950)]
SWAPS = [
    dict(notional=10_000_000, fixed=0.042, spread=0.0, tenor=5, fixedFreq=2, floatFreq=4, side="pay", curve=CURVE_A, note="5-year payer, semiannual fixed vs quarterly float"),
    dict(notional=25_000_000, fixed=0.045, spread=0.0015, tenor=10, fixedFreq=1, floatFreq=2, side="receive", curve=CURVE_A, note="10-year receiver with a 15 bp spread"),
    dict(notional=1_000_000, fixed=-0.001, spread=0.0, tenor=2, fixedFreq=1, floatFreq=4, side="pay", curve=CURVE_NEG, note="negative rates"),
    dict(notional=5_000_000, fixed=0.03, spread=0.0, tenor=1.5, fixedFreq=2, floatFreq=12, side="pay", curve=CURVE_A, note="18 months, monthly float"),
]


def log_linear(curve, t):
    if t <= 0:
        return 1.0
    t0, l0 = 0.0, 0.0
    for tc, dfc in curve:
        if t <= tc + 1e-12:
            return math.exp(l0 + (t - t0) / (tc - t0) * (math.log(dfc) - l0))
        t0, l0 = tc, math.log(dfc)
    raise ValueError("beyond curve")


swaps = []
for sw in SWAPS:
    dates = [TODAY] + [TODAY + ql.Period(int(round(tc * 12)), ql.Months) for tc, _ in sw["curve"]]
    dfs = [1.0] + [df for _, df in sw["curve"]]
    for (tc, _), d in zip(sw["curve"], dates[1:]):
        assert abs(TH.yearFraction(TODAY, d) - tc) < 1e-12
    curve = ql.DiscountCurve(dates, dfs, TH)
    h = ql.YieldTermStructureHandle(curve)
    index = ql.IborIndex("USER", PERIOD[sw["floatFreq"]], 0, ql.USDCurrency(), ql.NullCalendar(), ql.Unadjusted, False, TH, h)
    end = TODAY + ql.Period(int(round(sw["tenor"] * 12)), ql.Months)
    fs = ql.Schedule(TODAY, end, PERIOD[sw["fixedFreq"]], ql.NullCalendar(), ql.Unadjusted, ql.Unadjusted, ql.DateGeneration.Backward, False)
    gs = ql.Schedule(TODAY, end, PERIOD[sw["floatFreq"]], ql.NullCalendar(), ql.Unadjusted, ql.Unadjusted, ql.DateGeneration.Backward, False)
    typ = ql.Swap.Payer if sw["side"] == "pay" else ql.Swap.Receiver
    s = ql.VanillaSwap(typ, sw["notional"], fs, sw["fixed"], TH, gs, index, sw["spread"], TH)
    s.setPricingEngine(ql.DiscountingSwapEngine(h))
    # Closed form on the same grid.
    nf = int(round(sw["tenor"] * sw["fixedFreq"]))
    ng = int(round(sw["tenor"] * sw["floatFreq"]))
    ann = sum(log_linear(sw["curve"], k / sw["fixedFreq"]) / sw["fixedFreq"] for k in range(1, nf + 1))
    fann = sum(log_linear(sw["curve"], k / sw["floatFreq"]) / sw["floatFreq"] for k in range(1, ng + 1))
    pv_float = sw["notional"] * (1 - log_linear(sw["curve"], sw["tenor"])) + sw["notional"] * sw["spread"] * fann
    pv_fixed = sw["notional"] * sw["fixed"] * ann
    payer = pv_float - pv_fixed
    closed = payer if sw["side"] == "pay" else -payer
    assert abs(s.NPV() - closed) < 1e-10 * sw["notional"], (sw["note"], s.NPV(), closed)
    rec = dict(sw)
    rec["curve"] = [dict(t=tc, df=df) for tc, df in sw["curve"]]
    rec.update(value=s.NPV(), pvFixed=s.fixedLegNPV() * (-1 if sw["side"] == "pay" else 1),
               pvFloat=s.floatingLegNPV() * (1 if sw["side"] == "pay" else -1), parRate=s.fairRate(), annuity=ann)
    swaps.append(rec)

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(dict(generator="scripts/deriv-oracle.py", quantlib=ql.__version__, bsm=bsm, black76=b76, crr=crr_out, convergence=conv,
                   parity=parity, carry=carry, strategy=strat, swap=swaps), f, indent=1)
print("wrote", OUT, "QuantLib", ql.__version__)
