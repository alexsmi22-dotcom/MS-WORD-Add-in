"""
Oracle for the Release E5b microeconomics calculators (micro-market, micro-oligopoly). Synthetic, invented numbers;
writes src/lib/__tests__/fixtures/econ-micro-oracle.json. Every value is EXACT (sympy Rationals / fractions) and is
written as "n/d" (or "n").

micro-market: equilibrium by sympy.solve on the two curves; surpluses by sympy.integrate of the curves (NOT polygon
areas, which is how the engine computes them): CS = ∫(D(Q) − P_buyers) dQ, PS = ∫(P_sellers − max(S(Q), 0)) dQ (split
by hand at the Q where S = 0 when c < 0), DWL = ∫(D − S) dQ between the traded and the efficient quantity. A tax or
subsidy is solved twice, once with the supply curve shifted and once with the demand curve shifted, by sympy.solve.

micro-oligopoly: Cournot by KKT over cost-sorted prefixes (the active set of linear Cournot is a prefix of the cost
ranking) AND, for n ≤ 8, by enumerating every subset; Stackelberg by sympy: the leader's profit on each piece of the
follower's kinked response, critical points by sympy.solve, compared with the piece boundaries; Bertrand from the
textbook rule (Tirole 1988, ch. 5).

Run: jurislab-oracle-venv python scripts/econ-micro-oracle.py
"""
import itertools
import json
import os
from fractions import Fraction as F

import sympy as sp

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "__tests__", "fixtures", "econ-micro-oracle.json")
Q, P = sp.symbols("Q P")


def s(x):
    x = sp.Rational(x)
    return str(x.p) if x.q == 1 else f"{x.p}/{x.q}"


def rat(text):
    return sp.Rational(F(text))


# ------------------------------------------------------------------------------------------------- micro-market
def ps_integral(price, upto, c, d):
    """∫_0^upto (price − max(S(Q), 0)) dQ with S = c + dQ."""
    S = c + d * Q
    if c >= 0 or d == 0:
        return sp.integrate(price - S, (Q, 0, upto)) if c >= 0 else None
    q0 = -c / d
    if upto <= q0:
        return sp.integrate(price, (Q, 0, upto))
    return sp.integrate(price, (Q, 0, q0)) + sp.integrate(price - S, (Q, q0, upto))


def market_case(a, b, c, d, policy="none", amount=None, side="sellers"):
    a, b, c, d = rat(a), rat(b), rat(c), rat(d)
    D = a - b * Q
    S = c + d * Q
    qe = sp.solve(sp.Eq(D, S), Q)[0]
    pe = D.subs(Q, qe)
    out = {"qe": s(qe), "pe": s(pe), "eps": s(-(pe / (b * qe))), "eta": None if d == 0 else s(pe / (d * qe))}
    out["csE"] = s(sp.integrate(D - pe, (Q, 0, qe)))
    out["psE"] = s(ps_integral(pe, qe, c, d))
    res = {"binding": False}
    if policy in ("tax", "subsidy"):
        t = rat(amount)
        w = t if policy == "tax" else -t
        ways = {}
        # Shifted supply (levied on sellers): buyers pay the market price.
        qS = sp.solve(sp.Eq(D, S + w), Q)[0]
        bS = D.subs(Q, qS)
        ways["sellers"] = (qS, bS, bS - w)
        # Shifted demand (levied on buyers): sellers receive the market price.
        qB = sp.solve(sp.Eq(D - w, S), Q)[0]
        sB = S.subs(Q, qB)
        ways["buyers"] = (qB, sB + w, sB)
        out["ways"] = {
            k: {"q": s(v[0]), "buyers": s(v[1]), "sellers": s(v[2]), "buyerShare": s((v[1] - pe) / w), "sellerShare": s((pe - v[2]) / w)}
            for k, v in ways.items()
        }
        q, pb, pS = ways[side]
        res = {"binding": True, "q": s(q), "buyers": s(pb), "sellers": s(pS)}
        res["cs"] = s(sp.integrate(D - pb, (Q, 0, q)))
        res["ps"] = s(ps_integral(pS, q, c, d))
        if policy == "tax":
            res["rev"] = s(t * q)
            res["dwl"] = s(sp.integrate(D - S, (Q, q, qe)))
        else:
            res["sub"] = s(t * q)
            res["dwl"] = s(sp.integrate(S - D, (Q, qe, q)))
    elif policy == "ceiling":
        pc = rat(amount)
        if pc < pe:
            qs = sp.solve(sp.Eq(S, pc), Q)[0]
            qd = sp.solve(sp.Eq(D, pc), Q)[0]
            res = {"binding": True, "q": s(qs), "qd": s(qd), "qs": s(qs), "buyers": s(pc), "sellers": s(pc)}
            res["cs"] = s(sp.integrate(D - pc, (Q, 0, qs)))
            res["ps"] = s(ps_integral(pc, qs, c, d))
            res["dwl"] = s(sp.integrate(D - S, (Q, qs, qe)))
    elif policy == "floor":
        pf = rat(amount)
        if pf > pe:
            qd = sp.solve(sp.Eq(D, pf), Q)[0]
            qs = None if d == 0 else sp.solve(sp.Eq(S, pf), Q)[0]
            res = {"binding": True, "q": s(qd), "qd": s(qd), "qs": None if qs is None else s(qs), "buyers": s(pf), "sellers": s(pf)}
            res["cs"] = s(sp.integrate(D - pf, (Q, 0, qd)))
            res["ps"] = s(ps_integral(pf, qd, c, d))
            res["dwl"] = s(sp.integrate(D - S, (Q, qd, qe)))
    out["policy"] = res
    return out


MARKET_INPUTS = [
    dict(name="default tax on sellers", a="120", b="2", c="20", d="3", policy="tax", amount="10", side="sellers"),
    dict(name="awkward fractions, tax on buyers", a="100", b="1.5", c="10", d="0.7", policy="tax", amount="7/3", side="buyers"),
    dict(name="negative supply intercept, tax", a="50", b="0.5", c="-5", d="0.25", policy="tax", amount="12", side="sellers"),
    dict(name="perfectly elastic supply, tax", a="30", b="1", c="12", d="0", policy="tax", amount="3", side="sellers"),
    dict(name="subsidy to sellers", a="120", b="2", c="20", d="3", policy="subsidy", amount="5", side="sellers"),
    dict(name="subsidy to buyers, fractions", a="77/3", b="0.4", c="3.5", d="1.1", policy="subsidy", amount="2.25", side="buyers"),
    dict(name="binding ceiling", a="120", b="2", c="20", d="3", policy="ceiling", amount="56"),
    dict(name="ceiling with negative c", a="50", b="0.5", c="-5", d="0.25", policy="ceiling", amount="5"),
    dict(name="binding floor", a="120", b="2", c="20", d="3", policy="floor", amount="95"),
    dict(name="floor with perfectly elastic supply", a="30", b="1", c="12", d="0", policy="floor", amount="20"),
    dict(name="no policy, awkward decimals", a="10.5", b="0.3", c="1.2", d="0.45", policy="none"),
    dict(name="ceiling that does not bind", a="120", b="2", c="20", d="3", policy="ceiling", amount="90"),
    dict(name="huge scale", a="900000000000", b="0.000001", c="1000", d="0.000003", policy="tax", amount="100000000"),
]


# ---------------------------------------------------------------------------------------------- micro-oligopoly
def cournot_prefix(a, b, cs):
    order = sorted(range(len(cs)), key=lambda i: (cs[i], i))
    found = None
    for k in range(1, len(cs) + 1):
        act = order[:k]
        p = (a + sum(cs[i] for i in act)) / (k + 1)
        if all(cs[i] < p for i in act) and all(cs[i] >= p for i in order[k:]):
            found = (p, act)
            break
    p, act = found
    return p, [(p - cs[i]) / b if i in act else F(0) for i in range(len(cs))]


def cournot_subsets(a, b, cs):
    n = len(cs)
    sols = []
    for k in range(1, n + 1):
        for act in itertools.combinations(range(n), k):
            p = (a + sum(cs[i] for i in act)) / (k + 1)
            q = [(p - cs[i]) / b if i in act else F(0) for i in range(n)]
            if all(q[i] > 0 for i in act) and all(cs[i] >= p for i in range(n) if i not in act):
                sols.append((p, q))
    assert len(sols) == 1, sols
    return sols[0]


def stackelberg_sympy(a, b, c1, c2):
    a, b, c1, c2 = map(sp.Rational, (a, b, c1, c2))
    q1 = sp.symbols("q1", nonnegative=True)
    qlim = sp.Max(0, (a - c2) / b)
    r2 = lambda x: sp.Max(0, (a - c2 - b * x) / (2 * b))
    prof = lambda x: (a - b * (x + r2(x)) - c1) * x
    cands = {sp.Integer(0), qlim}
    # Piece with the follower active.
    pA = (a - b * (q1 + (a - c2 - b * q1) / (2 * b)) - c1) * q1
    for r in sp.solve(sp.diff(pA, q1), q1):
        if 0 <= r <= qlim:
            cands.add(r)
    pB = (a - b * q1 - c1) * q1
    for r in sp.solve(sp.diff(pB, q1), q1):
        if r >= qlim:
            cands.add(r)
    best = max(cands, key=lambda x: (prof(x), x))
    return best, r2(best)


def bertrand(a, b, cs):
    n = len(cs)
    cmin = min(cs)
    tied = [i for i in range(n) if cs[i] == cmin]
    q = [F(0)] * n
    pm = (a + cmin) / 2
    if n == 1:
        p = pm
        q[0] = (a - p) / b
    elif len(tied) >= 2:
        p = cmin
        for i in tied:
            q[i] = (a - p) / b / len(tied)
    else:
        c2 = sorted(cs)[1]
        p = min(c2, pm)
        q[tied[0]] = (a - p) / b
    return p, q


def oligopoly_case(a, b, costs):
    a, b = F(a), F(b)
    cs = [F(x) for x in costs]
    n = len(cs)
    cmin = min(cs)
    out = {}
    tied = [i for i in range(n) if cs[i] == cmin]
    qc = [F(0)] * n
    for i in tied:
        qc[i] = (a - cmin) / b / len(tied)
    qm = [F(0)] * n
    qm[tied[0]] = (a - cmin) / (2 * b)
    pc, qn = cournot_prefix(a, b, cs)
    if n <= 8:
        p2, q2 = cournot_subsets(a, b, cs)
        assert p2 == pc and q2 == qn
    pb, qb = bertrand(a, b, cs)
    structs = {"competition": (cmin, qc), "monopoly": ((a + cmin) / 2, qm), "cournot": (pc, qn), "bertrand": (pb, qb)}
    if n == 2:
        l, f = stackelberg_sympy(a, b, cs[0], cs[1])
        l, f = F(int(sp.Rational(l).p), int(sp.Rational(l).q)), F(int(sp.Rational(f).p), int(sp.Rational(f).q))
        structs["stackelberg"] = (a - b * (l + f), [l, f])
    tot_comp = None
    for key in ["competition", "monopoly", "cournot", "bertrand", "stackelberg"]:
        if key not in structs:
            continue
        p, q = structs[key]
        Qt = sum(q)
        prof = [(p - cs[i]) * q[i] for i in range(n)]
        cs_ = b * Qt * Qt / 2
        ts = cs_ + sum(prof)
        if key == "competition":
            tot_comp = ts
        lerner = sum((q[i] / Qt) * (p - cs[i]) / p for i in range(n) if q[i] > 0) if p > 0 else F(0)
        hhi = sum((100 * q[i] / Qt) ** 2 for i in range(n) if q[i] > 0)
        out[key] = {
            "price": s(p), "total": s(Qt), "q": [s(x) for x in q], "profit": [s(x) for x in prof],
            "cs": s(cs_), "ts": s(ts), "dwl": s(tot_comp - ts), "lerner": s(lerner), "hhi": s(hhi),
        }
    return out


OLIGOPOLY_INPUTS = [
    dict(name="default two firms", a="120", b="1", costs=["10", "20"]),
    dict(name="Cournot exits", a="100", b="2", costs=["10", "20", "30", "70", "90"]),
    dict(name="Bertrand monopoly price below c2, Stackelberg follower deterred at monopoly output", a="50", b="1", costs=["10", "40"]),
    dict(name="Stackelberg limit quantity", a="100", b="1", costs=["10", "45"]),
    dict(name="high-cost leader", a="100", b="1", costs=["60", "10"]),
    dict(name="tied lowest costs", a="60", b="0.5", costs=["12", "12", "30"]),
    dict(name="zero marginal costs", a="90", b="3", costs=["0", "0"]),
    dict(name="single firm", a="40", b="2", costs=["8"]),
    dict(name="firm with cost above a", a="50", b="1", costs=["10", "60"]),
    dict(name="awkward fractions", a="97/3", b="0.7", costs=["1.25", "7/4", "2.2"]),
    dict(name="twenty firms", a="1000", b="0.3", costs=[str(F(37 * k % 101, 7) + F(k, 3)) for k in range(1, 21)]),
]


def main():
    market = []
    for m in MARKET_INPUTS:
        kw = {k: v for k, v in m.items() if k != "name"}
        market.append({"name": m["name"], "input": kw, "expect": market_case(**kw)})
    olig = []
    for o in OLIGOPOLY_INPUTS:
        olig.append({"name": o["name"], "input": {"a": o["a"], "b": o["b"], "costs": o["costs"]}, "expect": oligopoly_case(o["a"], o["b"], o["costs"])})
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"market": market, "oligopoly": olig}, fh, indent=1, ensure_ascii=False)
    print(f"wrote {OUT}: {len(market)} market cases, {len(olig)} oligopoly cases")


if __name__ == "__main__":
    main()
