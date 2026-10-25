"""Independent oracle for src/lib/patentDamages.ts (E1b). Decimal arithmetic, ROUND_HALF_UP per period."""
from decimal import Decimal as D, ROUND_HALF_UP, getcontext
import json

getcontext().prec = 50
C = D("0.01")


def cents(x):
    return x.quantize(C, rounding=ROUND_HALF_UP)


def royalty(bases, basis, rate, apportion, lump, disc, ppy):
    mult = (D(rate) / 100 if basis == "revenue" else D(rate)) * D(apportion) / 100
    out = []
    cum = D(0)
    pv = D(0)
    pvs = []
    d = D(disc) / 100
    for k, b in enumerate(bases):
        r = cents(D(b) * mult)
        cum += r
        if D(lump) > 0:
            pk = cents(r * (1 + d) ** (-(D(k + 1) / D(ppy))))
            pvs.append(str(pk))
            pv += pk
        out.append(str(r))
    res = {"periods": out, "total": str(sum((D(x) for x in out), D(0)))}
    if D(lump) > 0:
        res["pvs"] = pvs
        res["pv"] = str(cents(pv))
        res["diff"] = str(cents(D(lump) - cents(pv)))
    return res


def lost_profits(rows, method, capture, ps, is_, cap, mmode, price, cost, margin, erosion, bfp, ap, el, rem, remrate, iprice):
    if method == "share":
        c = D(capture) / 100
    else:
        c = D(ps) / (100 - D(is_))
    um = D(price) - D(cost) if mmode == "price-cost" else D(margin)
    shed = D(ap) - D(cost) if mmode == "price-cost" else D(margin)
    rpu = D(remrate) if rem == "unit" else (D(iprice) * D(remrate) / 100 if rem == "revenue" else D(0))
    per = []
    for row in rows:
        units = D(row[0])
        own = D(row[1]) if len(row) > 1 else D(0)
        dem = units * c
        if len(row) >= 3:
            capd = min(dem, D(row[2]))
        elif D(cap) > 0:
            capd = min(dem, D(cap))
        else:
            capd = dem
        lp = cents(capd * um)
        e = D(0)
        if erosion and own > 0:
            dp = D(bfp) - D(ap)
            if D(el) > 0:
                qbf = own * (1 - D(el) * dp / D(ap))
                e = cents(qbf * dp - (own - qbf) * shed)
            else:
                e = cents(own * dp)
        rr = cents((units - capd) * rpu) if rem != "none" else D(0)
        per.append({"captured": str(capd), "lp": str(lp), "pe": str(e), "rr": str(rr), "total": str(cents(lp + e + rr))})
    tot = {k: str(sum((D(p[k]) for p in per), D(0))) for k in ("lp", "pe", "rr", "total")}
    return {"capture": str(c), "periods": per, "totals": tot}


def summary(rows, mult):
    per = []
    for r in rows:
        lp, pe, rr = (cents(D(r[i])) if len(r) > i else D(0) for i in range(3))
        it = cents(D(r[3])) if len(r) > 3 else D(0)
        dmg = cents(lp + pe + rr)
        per.append({"dmg": dmg, "it": it, "total": cents(dmg + it)})
    T = sum((p["dmg"] for p in per), D(0))
    I = sum((p["it"] for p in per), D(0))
    enh = cents(T * D(mult))
    return {"damages": str(T), "interest": str(I), "enhanced": str(enh), "grand": str(cents(enh + I)), "periodTotals": [str(p["total"]) for p in per]}


cases = {
    "R1": royalty(["4000000", "5500000", "6250000", "3100000"], "revenue", "3", "40", "200000", "8", "1"),
    "R2": royalty(["12345", "23456.5", "7891"], "unit", "2.35", "100", "0", "0", "1"),
    "R3": royalty(["1234567.89", "2345678.91", "987654.32", "1111111.11"], "revenue", "4.5", "62.5", "150000", "10", "4"),
    "L1": lost_profits([["12000", "30000", "5000"], ["15000", "32000", "6000"], ["9000", "28000", "6000"]],
                       "share", "60", "40", "25", "0", "price-cost", "120", "70", "50", True, "130", "120", "0", "unit", "4", "110"),
    "L2": lost_profits([["10000", "20000"], ["12500", "21000"], ["7333", "19000"]],
                       "market", "0", "40", "25", "0", "margin", "0", "0", "37.25", True, "105", "100", "1.5", "revenue", "5", "90"),
    "L3": lost_profits([["9500"], ["12000"], ["4100"]],
                       "share", "100", "0", "0", "8000", "price-cost", "99.99", "45.55", "0", False, "0", "0", "0", "none", "0", "0"),
    "S1": summary([["300000", "280000", "28000"], ["400000", "320000", "36000"], ["300000", "280000", "12000"]], "1"),
    "S2": summary([["125000.10", "0", "18000.25", "4321.09"], ["98000.55", "1500", "17000", "2100.5"]], "2"),
    "S3": summary([["1000.005", "2000.004", "0.333"], ["0", "0", "999.995"]], "3"),
}
print(json.dumps(cases, indent=1))
