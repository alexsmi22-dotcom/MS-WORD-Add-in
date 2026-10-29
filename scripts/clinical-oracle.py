"""
Oracle for the v2.206.0 clinical-research Stats calculators (src/lib/diagnosticAccuracy.ts, epi2x2.ts, agreement.ts,
metaAnalysis.ts, clinicalStatCalcs.ts).

Run:  ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/clinical-oracle.py
Writes src/lib/__tests__/fixtures/clinical-oracle.json.

Sources, per quantity:
  proportions     statsmodels proportion_confint (method "wilson" and "beta" = Clopper-Pearson)
  DOR, OR, RR     statsmodels Table2x2 (oddsratio_confint = Woolf, riskratio_confint = Katz log), shift_zeros=True for
                  the Haldane-Anscombe path
  RD              statsmodels confint_proportions_2indep (compare="diff", method "wald" and "newcomb")
  chi2 / Fisher   scipy chi2_contingency(correction=False) and fisher_exact
  LR+/LR-, Mercaldo PPV/NPV, Buderer: closed forms evaluated here in numpy (formulas cited in diagnosticAccuracy.ts)
  AUC             sklearn roc_auc_score; DeLong variance and the paired test by an independent O(m*n) numpy
                  implementation of the structural components (DeLong et al. 1988, eq. 4-5), not the midrank shortcut
                  the TypeScript uses
  IRR exact       scipy binomtest(...).pvalue and .proportion_ci(method="exact"), converted to the rate ratio
  kappa           statsmodels inter_rater.cohens_kappa (wt None / "linear" / "quadratic"): kappa, std_kappa, std_kappa0
  Bland-Altman    numpy; scipy linregress for the proportional-bias slope
  ICC             pingouin 0.7 intraclass_corr (ICC1, ICC2, ICC3, ICC1k, ICC2k, ICC3k with CI95%)
  meta            statsmodels combine_effects (fixed IV, DerSimonian-Laird); StratifiedTable (Mantel-Haenszel OR and
                  its Robins-Breslow-Greenland SE); REML by scipy minimize_scalar of the restricted log-likelihood
                  (independent of the TypeScript's fixed-point iteration); MH RR and MH RD by numpy from the
                  Greenland-Robins formulas; I2 interval by the Higgins-Thompson formula in numpy; Egger by statsmodels OLS

Published data used:
  Altman & Bland 1994, BMJ 308:1552 (liver scan): TP 231, FP 32, FN 27, TN 54.
  Hanley & McNeil 1982, Radiology 143:29, Table 1 (CT ratings 1-5): normals 33/6/6/11/2, abnormals 3/2/2/11/33.
  Bland & Altman 1986, Lancet i:307 (PEFR, Wright vs mini Wright, first readings, 17 subjects).
  Shrout & Fleiss 1979, Psychol Bull 86:420, Table 2 (6 targets x 4 judges).
  Colditz et al. 1994 BCG trials (13 studies), as in metafor's dat.bcg (Viechtbauer 2010, J Stat Softw 36(3)).
"""
import json
import math
import os

import numpy as np
import pandas as pd
import pingouin as pg
from scipy import stats, optimize
from sklearn.metrics import roc_auc_score
from statsmodels.stats.proportion import proportion_confint, confint_proportions_2indep
from statsmodels.stats.contingency_tables import Table2x2, StratifiedTable
from statsmodels.stats.inter_rater import cohens_kappa
from statsmodels.stats.meta_analysis import combine_effects
import statsmodels.api as sm

Z = stats.norm.ppf(0.975)
OUT = {}

# ---------------------------------------------------------------- diagnostic 2x2
def diag(tp, fp, fn, tn):
    r = {"input": [tp, fp, fn, tn]}
    for m, key in (("wilson", "wilson"), ("beta", "cp")):
        def pc(x, n):
            lo, hi = proportion_confint(x, n, alpha=0.05, method=m)
            return [x / n, float(lo), float(hi)]
        r[key] = {"sens": pc(tp, tp + fn), "spec": pc(tn, fp + tn), "ppv": pc(tp, tp + fp), "npv": pc(tn, fn + tn), "acc": pc(tp + tn, tp + fp + fn + tn)}
    zero = min(tp, fp, fn, tn) == 0
    # Haldane-Anscombe per ratio, only where the ratio is 0, infinite or 0/0 (review B4): LR+ needs TP, FP > 0;
    # LR- needs FN, TN > 0; the DOR needs every cell > 0.
    kp = 0.5 if (tp == 0 or fp == 0) else 0.0
    kn = 0.5 if (fn == 0 or tn == 0) else 0.0
    a, b, c, d = tp + kp, fp + kp, fn + kp, tn + kp
    lrp = (a / (a + c)) / (b / (b + d))
    s = math.sqrt(1 / a - 1 / (a + c) + 1 / b - 1 / (b + d))
    a, b, c, d = tp + kn, fp + kn, fn + kn, tn + kn
    lrn = (c / (a + c)) / (d / (b + d))
    s2 = math.sqrt(1 / c - 1 / (a + c) + 1 / d - 1 / (b + d))
    r["lrPos"] = [lrp, lrp * math.exp(-Z * s), lrp * math.exp(Z * s)]
    r["lrNeg"] = [lrn, lrn * math.exp(-Z * s2), lrn * math.exp(Z * s2)]
    t = Table2x2(np.array([[tp, fp], [fn, tn]], dtype=float) + (0.5 if zero else 0.0), shift_zeros=False)  # Haldane-Anscombe: 0.5 to EVERY cell (statsmodels shift_zeros replaces only the zeros, and is on by default)
    lo, hi = t.oddsratio_confint()
    r["dor"] = [float(t.oddsratio), float(lo), float(hi)]
    r["haldane"] = zero
    # Mercaldo PPV/NPV at prevalence 0.10 from the 2x2's Se, Sp (uncorrected)
    Se, Sp, n1, n0, p = tp / (tp + fn), tn / (fp + tn), tp + fn, fp + tn, 0.10
    if 0 < Se < 1 and 0 < Sp < 1:
        ppv = Se * p / (Se * p + (1 - Sp) * (1 - p))
        npv = Sp * (1 - p) / (Sp * (1 - p) + (1 - Se) * p)
        vp = (1 - Se) / (Se * n1) + Sp / ((1 - Sp) * n0)
        vn = Se / ((1 - Se) * n1) + (1 - Sp) / (Sp * n0)
        ex = lambda x: 1 / (1 + math.exp(-x))
        lp, ln_ = math.log(ppv / (1 - ppv)), math.log(npv / (1 - npv))
        r["at10"] = {"ppv": [ppv, ex(lp - Z * math.sqrt(vp)), ex(lp + Z * math.sqrt(vp))], "npv": [npv, ex(ln_ - Z * math.sqrt(vn)), ex(ln_ + Z * math.sqrt(vn))]}
    return r

OUT["diag"] = {"liver": diag(231, 32, 27, 54), "default": diag(90, 30, 10, 170), "fn0": diag(50, 10, 0, 40), "fp1fn0": diag(50, 1, 0, 60)}

# Buderer: Se 0.90, Sp 0.85, d 0.05, prevalence 0.20
def buderer(se, sp, prev, d):
    ns = math.ceil(Z * Z * se * (1 - se) / (d * d * prev) - 1e-9)
    nsp = math.ceil(Z * Z * sp * (1 - sp) / (d * d * (1 - prev)) - 1e-9)
    return [ns, nsp, max(ns, nsp)]
OUT["buderer"] = {"a": {"input": [0.90, 0.85, 0.20, 0.05], "n": buderer(0.90, 0.85, 0.20, 0.05)}, "b": {"input": [0.80, 0.95, 0.5, 0.10], "n": buderer(0.80, 0.95, 0.5, 0.10)}}

# ---------------------------------------------------------------- ROC / DeLong
def delong_components(pos, neg):
    pos = np.asarray(pos, float); neg = np.asarray(neg, float)
    psi = (pos[:, None] > neg[None, :]).astype(float) + 0.5 * (pos[:, None] == neg[None, :])
    return psi.mean(), psi.mean(axis=1), psi.mean(axis=0)

def roc_case(y, s1, s2=None):
    y = np.asarray(y); s1 = np.asarray(s1, float)
    auc, v10, v01 = delong_components(s1[y == 1], s1[y == 0])
    m, n = len(v10), len(v01)
    var = v10.var(ddof=1) / m + v01.var(ddof=1) / n
    r = {"y": y.tolist(), "s1": s1.tolist(), "auc": float(auc), "sk": float(roc_auc_score(y, s1)), "se": math.sqrt(var)}
    if s2 is not None:
        s2 = np.asarray(s2, float)
        auc2, w10, w01 = delong_components(s2[y == 1], s2[y == 0])
        var2 = w10.var(ddof=1) / m + w01.var(ddof=1) / n
        cov = np.cov(v10, w10, ddof=1)[0, 1] / m + np.cov(v01, w01, ddof=1)[0, 1] / n
        sed = math.sqrt(var + var2 - 2 * cov)
        zz = (auc - auc2) / sed
        r.update({"s2": s2.tolist(), "auc2": float(auc2), "se2": math.sqrt(var2), "diffSe": sed, "z": zz, "p": 2 * stats.norm.sf(abs(zz))})
    # Youden: max J over distinct cutoffs (score >= c), ties -> higher specificity
    best = None
    for c in sorted(set(s1.tolist()), reverse=True):
        sens = float(np.mean(s1[y == 1] >= c)); spec = float(np.mean(s1[y == 0] < c))
        J = sens + spec - 1
        if best is None or J > best[0] + 1e-12 or (abs(J - best[0]) <= 1e-12 and spec > best[3]):
            best = (J, c, sens, spec)
    r["youden"] = list(best)
    return r

hm_y = [0] * 58 + [1] * 51
hm_s = [1] * 33 + [2] * 6 + [3] * 6 + [4] * 11 + [5] * 2 + [1] * 3 + [2] * 2 + [3] * 2 + [4] * 11 + [5] * 33
rng = np.random.default_rng(20261028)
ny, nn = 40, 60
yy = np.array([1] * ny + [0] * nn)
s1 = np.round(np.concatenate([rng.normal(1.2, 1, ny), rng.normal(0, 1, nn)]), 1)
s2 = np.round(0.6 * s1 + np.concatenate([rng.normal(0.3, 1, ny), rng.normal(0, 1, nn)]), 1)
OUT["roc"] = {"hanleyMcNeil": roc_case(hm_y, hm_s), "paired": roc_case(yy, s1, s2)}

# ---------------------------------------------------------------- 2x2 epidemiology
def epi(a, b, c, d):
    zero = min(a, b, c, d) == 0
    # Haldane-Anscombe on every cell, per ratio, only where that ratio is 0 or infinite (review B4): the RR when a or c
    # is 0, the OR when any cell is 0.
    trr = Table2x2(np.array([[a, b], [c, d]], dtype=float) + (0.5 if (a == 0 or c == 0) else 0.0), shift_zeros=False)
    tor = Table2x2(np.array([[a, b], [c, d]], dtype=float) + (0.5 if zero else 0.0), shift_zeros=False)
    rr = [float(trr.riskratio), *map(float, trr.riskratio_confint())]
    orr = [float(tor.oddsratio), *map(float, tor.oddsratio_confint())]
    rd = {}
    for m in ("wald", "newcomb"):
        lo, hi = confint_proportions_2indep(a, a + b, c, c + d, method=m, compare="diff")
        rd[m] = [a / (a + b) - c / (c + d), float(lo), float(hi)]
    chi2, p, dof, _ = stats.chi2_contingency(np.array([[a, b], [c, d]]), correction=False)
    _, pf = stats.fisher_exact([[a, b], [c, d]])
    return {"input": [a, b, c, d], "rr": rr, "or": orr, "rd": rd, "chi2": float(chi2), "p": float(p), "pFisher": float(pf), "haldane": zero}

OUT["epi"] = {"default": epi(15, 85, 30, 70), "zero": epi(0, 20, 5, 15), "small": epi(3, 7, 9, 1), "bZero": epi(10, 0, 5, 5)}

def irr(a, t1, c, t0):
    bt = stats.binomtest(a, a + c, t1 / (t1 + t0))
    ci = bt.proportion_ci(confidence_level=0.95, method="exact")
    conv = lambda p: p / (1 - p) * t0 / t1
    r = (a / t1) / (c / t0)
    s = math.sqrt(1 / a + 1 / c) if a > 0 else None
    return {"input": [a, t1, c, t0], "irr": r, "exact": [conv(ci.low), conv(ci.high)], "p": float(bt.pvalue),
            "wald": [r * math.exp(-Z * s), r * math.exp(Z * s)] if s else None}

OUT["irr"] = {"default": irr(41, 28010, 15, 19017), "small": irr(2, 500, 9, 800), "zeroA": irr(0, 300, 6, 400)}

# ---------------------------------------------------------------- kappa
def kap(table):
    r = {"table": table}
    for wt, key in ((None, "none"), ("linear", "linear"), ("quadratic", "quadratic")):
        k = cohens_kappa(np.array(table, dtype=float), wt=wt)
        r[key] = {"kappa": float(k.kappa), "se": float(k.std_kappa), "se0": float(k.std_kappa0)}
    return r

OUT["kappa"] = {"k3": kap([[22, 2, 2], [2, 8, 2], [4, 4, 14]]), "k4": kap([[11, 3, 1, 0], [2, 13, 4, 1], [1, 3, 15, 4], [0, 1, 2, 9]])}

# ---------------------------------------------------------------- Bland-Altman (PEFR 1986)
wright = [494, 395, 516, 434, 476, 557, 413, 442, 650, 433, 417, 656, 267, 478, 178, 423, 427]
mini = [512, 430, 520, 428, 500, 600, 364, 380, 658, 445, 432, 626, 260, 477, 259, 350, 451]
dd = np.array(wright, float) - np.array(mini, float)
mm = (np.array(wright, float) + np.array(mini, float)) / 2
n = len(dd)
sd = dd.std(ddof=1)
tq = stats.t.ppf(0.975, n - 1)
lr = stats.linregress(mm, dd)
OUT["bland"] = {"a": wright, "b": mini, "bias": dd.mean(), "sd": sd,
                "loa196": [dd.mean() - 1.96 * sd, dd.mean() + 1.96 * sd], "loa2": [dd.mean() - 2 * sd, dd.mean() + 2 * sd],
                "biasCi": [dd.mean() - tq * sd / math.sqrt(n), dd.mean() + tq * sd / math.sqrt(n)],
                "loaHalf": tq * sd * math.sqrt(3 / n), "slope": lr.slope, "slopeP": lr.pvalue}

# ---------------------------------------------------------------- ICC
def icc(mat):
    mat = np.array(mat, float)
    nT, nR = mat.shape
    df = pd.DataFrame([(i, j, mat[i, j]) for i in range(nT) for j in range(nR)], columns=["t", "r", "s"])
    res = pg.intraclass_corr(df, targets="t", raters="r", ratings="s")
    out = {"data": mat.tolist()}
    # pingouin prints its CI95 to 2 decimals: kept as "pgCi" (checked to 0.005); the full-precision intervals below
    # are the McGraw & Wong (1996) F formulas evaluated with scipy's F quantiles.
    for _, row in res.iterrows():
        out[row["Type"]] = [float(row["ICC"]), float(row["F"]), float(row["pval"])]
        out[row["Type"] + " pgCi"] = [float(row["CI95"][0]), float(row["CI95"][1])]
    k, n = nR, nT
    g = mat.mean(); rm = mat.mean(axis=1); cm = mat.mean(axis=0)
    ssr = k * np.sum((rm - g) ** 2); ssc = n * np.sum((cm - g) ** 2); sst = np.sum((mat - g) ** 2); sse = sst - ssr - ssc
    msr, msc, mse, msw = ssr / (n - 1), ssc / (k - 1), sse / ((n - 1) * (k - 1)), (ssc + sse) / (n * (k - 1))
    q = 0.975
    f1 = msr / msw; f1l = f1 / stats.f.ppf(q, n - 1, n * (k - 1)); f1u = f1 * stats.f.ppf(q, n * (k - 1), n - 1)
    f3 = msr / mse; f3l = f3 / stats.f.ppf(q, n - 1, (n - 1) * (k - 1)); f3u = f3 * stats.f.ppf(q, (n - 1) * (k - 1), n - 1)
    icc2 = (msr - mse) / (msr + (k - 1) * mse + k * (msc - mse) / n)
    fc = msc / mse
    vn = (k - 1) * (n - 1) * (k * icc2 * fc + n * (1 + (k - 1) * icc2) - k * icc2) ** 2
    vd = (n - 1) * k ** 2 * icc2 ** 2 * fc ** 2 + (n * (1 + (k - 1) * icc2) - k * icc2) ** 2
    v = vn / vd
    f2u = stats.f.ppf(q, n - 1, v); f2l = stats.f.ppf(q, v, n - 1)
    lb2 = n * (msr - f2u * mse) / (f2u * (k * msc + (k * n - k - n) * mse) + n * msr)
    ub2 = n * (f2l * msr - mse) / (k * msc + (k * n - k - n) * mse + n * f2l * msr)
    avg = lambda x: x * k / (1 + x * (k - 1))
    out["ci"] = {"ICC(1,1)": [(f1l - 1) / (f1l + k - 1), (f1u - 1) / (f1u + k - 1)], "ICC(2,1)": [lb2, ub2],
                 "ICC(3,1)": [(f3l - 1) / (f3l + k - 1), (f3u - 1) / (f3u + k - 1)], "ICC(1,k)": [1 - 1 / f1l, 1 - 1 / f1u],
                 "ICC(2,k)": [avg(lb2), avg(ub2)], "ICC(3,k)": [1 - 1 / f3l, 1 - 1 / f3u]}
    return out

sf = [[9, 2, 5, 8], [6, 1, 3, 2], [8, 4, 6, 8], [7, 1, 2, 6], [10, 5, 6, 9], [6, 2, 4, 7]]
wine = pg.read_dataset("icc").pivot(index="Wine", columns="Judge", values="Scores").values.tolist()
OUT["icc"] = {"shroutFleiss": icc(sf), "wine": icc(wine)}

# ---------------------------------------------------------------- meta-analysis (BCG)
bcg = [("Aronson", 4, 119, 11, 128), ("Ferguson & Simes", 6, 300, 29, 274), ("Rosenthal 1960", 3, 228, 11, 209),
       ("Hart & Sutherland", 62, 13536, 248, 12619), ("Frimodt-Moller", 33, 5036, 47, 5761), ("Stein & Aronson", 180, 1361, 372, 1079),
       ("Vandiviere", 8, 2537, 10, 619), ("TPT Madras", 505, 87886, 499, 87892), ("Coetzee & Berjak", 29, 7470, 45, 7232),
       ("Rosenthal 1961", 17, 1699, 65, 1600), ("Comstock 1974", 186, 50448, 141, 27197), ("Comstock & Webster", 5, 2493, 3, 2338),
       ("Comstock 1976", 27, 16886, 29, 17825)]

def reml(y, v):
    def nll(t):
        w = 1 / (v + t)
        mu = np.sum(w * y) / np.sum(w)
        return 0.5 * (np.sum(np.log(v + t)) + np.log(np.sum(w)) + np.sum(w * (y - mu) ** 2))
    r = optimize.minimize_scalar(nll, bounds=(0, 10), method="bounded", options={"xatol": 1e-12})
    return float(r.x)

def meta_block(y, v):
    res = combine_effects(y, v, method_re="dl")
    k = len(y)
    w = 1 / v
    muF = np.sum(w * y) / np.sum(w)
    Q = float(np.sum(w * (y - muF) ** 2))
    i2 = max(0.0, (Q - (k - 1)) / Q)
    if Q > k:
        se = 0.5 * (math.log(Q) - math.log(k - 1)) / (math.sqrt(2 * Q) - math.sqrt(2 * k - 3))
    else:
        se = math.sqrt(1 / (2 * (k - 2)) * (1 - 1 / (3 * (k - 2) ** 2)))
    H = math.sqrt(max(1, Q / (k - 1)))
    hl, hh = max(1, math.exp(math.log(H) - Z * se)), max(1, math.exp(math.log(H) + Z * se))
    tauR = reml(y, v)
    wr = 1 / (v + tauR)
    muR = np.sum(wr * y) / np.sum(wr)
    seR = math.sqrt(1 / np.sum(wr))
    tq = stats.t.ppf(0.975, k - 2)
    wdl = 1 / (v + res.tau2)
    muDL = float(res.mean_effect_re)
    seDL = float(res.sd_eff_w_re) if hasattr(res, "sd_eff_w_re") else math.sqrt(1 / np.sum(wdl))
    return {"fixed": [float(res.mean_effect_fe), float(res.sd_eff_w_fe)], "dl": [muDL, math.sqrt(1 / np.sum(wdl)), float(res.tau2)],
            "Q": Q, "pQ": float(stats.chi2.sf(Q, k - 1)), "i2": i2, "i2ci": [(hl * hl - 1) / (hl * hl), (hh * hh - 1) / (hh * hh)],
            "reml": [float(muR), seR, tauR],
            "piDL": [muDL - tq * math.sqrt(res.tau2 + 1 / np.sum(wdl)), muDL + tq * math.sqrt(res.tau2 + 1 / np.sum(wdl))]}

def counts_logrr(rows):
    y, v = [], []
    for _, a, b, c, d in rows:
        y.append(math.log(a / (a + b) / (c / (c + d)))); v.append(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d))
    return np.array(y), np.array(v)

def counts_logor(rows):
    y, v = [], []
    for _, a, b, c, d in rows:
        y.append(math.log(a * d / (b * c))); v.append(1 / a + 1 / b + 1 / c + 1 / d)
    return np.array(y), np.array(v)

yrr, vrr = counts_logrr(bcg)
yor, vor = counts_logor(bcg)
st = StratifiedTable([np.array([[a, b], [c, d]], float) for _, a, b, c, d in bcg])
# MH RR, Greenland-Robins variance
R = S = P = 0.0
Wd = num = vnum = 0.0
for _, a, b, c, d in bcg:
    n1, n0 = a + b, c + d
    n = n1 + n0
    R += a * n0 / n; S += c * n1 / n; P += (n1 * n0 * (a + c) - a * c * n) / n ** 2
    w = n1 * n0 / n
    Wd += w; num += w * (a / n1 - c / n0); vnum += (a * b * n0 ** 3 + c * d * n1 ** 3) / (n1 * n0 * n * n)
egger_x = 1 / np.sqrt(vrr)
ols = sm.OLS(yrr * egger_x, sm.add_constant(egger_x)).fit()
OUT["meta"] = {"bcg": [list(r) for r in bcg], "rr": meta_block(yrr, vrr), "or": meta_block(yor, vor),
               "mhOR": [math.log(st.oddsratio_pooled), float(st.logodds_pooled_se)],
               "mhRR": [math.log(R / S), math.sqrt(P / (R * S))], "mhRD": [num / Wd, math.sqrt(vnum / Wd ** 2)],
               "eggerRR": [float(ols.params[0]), float(ols.bse[0]), float(ols.pvalues[0])]}
# Review B5: MH risk difference with an all-or-none study and a double-zero study, every study kept
# (Greenland-Robins 1985; the Cochrane Handbook formulas).
def mh_rd(rows):
    W = num = vn = 0.0
    for a, n1, c, n0 in rows:
        b, d, n = n1 - a, n0 - c, n1 + n0
        w = n1 * n0 / n
        W += w; num += w * (a / n1 - c / n0); vn += (a * b * n0 ** 3 + c * d * n1 ** 3) / (n1 * n0 * n * n)
    return [num / W, math.sqrt(vn / W ** 2)]
rd4 = [(3, 20, 8, 20), (5, 30, 9, 30), (10, 10, 0, 10), (0, 15, 0, 15)]
OUT["mhRdAllOrNone"] = {"studies": [list(x) for x in rd4], "mh": mh_rd(rd4)}
# Review B1: the exact binomial test at large counts (the TypeScript sums outward from the mode).
OUT["binomLarge"] = [{"x": x, "n": n, "p0": p0, "p": float(stats.binomtest(x, n, p0).pvalue)} for (x, n, p0) in
                     [(5000, 10000, 0.5), (5100, 10000, 0.5), (4930, 10000, 0.5), (41, 56, 28010 / 47027), (500300, 1000000, 0.5), (12, 400, 0.05)]]
# tau^2 = 0 case: three homogeneous studies (effect, se)
y0 = np.array([0.10, 0.12, 0.11]); v0 = np.array([0.04, 0.05, 0.03]) ** 2
r0 = combine_effects(y0, v0, method_re="dl")
OUT["metaTau0"] = {"y": y0.tolist(), "se": np.sqrt(v0).tolist(), "tau2": float(r0.tau2), "fixed": float(r0.mean_effect_fe), "random": float(r0.mean_effect_re)}

# ---------------------------------------------------------------- dosing (Engineering: dosing.ts), independent re-implementation
# Coefficients typed from the papers (Inker et al. 2021 NEJM 385:1737, Supplementary Table S10 equations; the R package
# kidney.epi egfr.ckdepi.cr.2021 / egfr.ckdepi.cr_cys.2021 carries the same numbers).
def ckd_cr(scr, age, female):
    k, a = (0.7, -0.241) if female else (0.9, -0.302)
    return 142 * min(scr / k, 1) ** a * max(scr / k, 1) ** -1.2 * 0.9938 ** age * (1.012 if female else 1)

def ckd_crcys(scr, cys, age, female):
    k, a = (0.7, -0.219) if female else (0.9, -0.144)
    return 135 * min(scr / k, 1) ** a * max(scr / k, 1) ** -0.544 * min(cys / 0.8, 1) ** -0.323 * max(cys / 0.8, 1) ** -0.778 * 0.9961 ** age * (0.963 if female else 1)

dose_cases = []
for (age, female, scr, cys, w, h) in [(60, True, 1.0, 1.1, 70, 175), (45, False, 0.7, 0.6, 95, 182), (80, True, 2.4, 2.0, 52, 150), (30, False, 1.2, 0.9, 120, 190), (70, False, 4.5, 3.1, 64, 168)]:
    hin = h / 2.54
    ibw = (45.5 if female else 50) + 2.3 * (hin - 60)
    bmi = w / (h / 100) ** 2
    dose_cases.append({
        "input": [age, "female" if female else "male", scr, cys, w, h],
        "egfrCr": ckd_cr(scr, age, female), "egfrCrCys": ckd_crcys(scr, cys, age, female),
        "cg": (140 - age) * w / (72 * scr) * (0.85 if female else 1),
        "bsa": [math.sqrt(h * w / 3600), 0.007184 * w ** 0.425 * h ** 0.725, 0.024265 * w ** 0.5378 * h ** 0.3964, 0.0235 * w ** 0.51456 * h ** 0.42246],
        "ibw": ibw, "adj": ibw + 0.4 * (w - ibw),
        "lbw": 9270 * w / ((8780 + 244 * bmi) if female else (6680 + 216 * bmi)), "bmi": bmi,
    })
OUT["dosing"] = dose_cases

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "lib", "__tests__", "fixtures", "clinical-oracle.json")


def clean(o):
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return o


with open(path, "w", encoding="utf-8") as f:
    json.dump(clean(OUT), f, indent=1)
print("wrote", path)
print("ICC SF", {k: round(v[0], 3) for k, v in OUT["icc"]["shroutFleiss"].items() if k.startswith("ICC") and "pg" not in k})
print("HM AUC", OUT["roc"]["hanleyMcNeil"]["auc"], "BA", OUT["bland"]["bias"], OUT["bland"]["loa2"])
print("BCG RR REML", OUT["meta"]["rr"]["reml"], "DL", OUT["meta"]["rr"]["dl"], "I2", OUT["meta"]["rr"]["i2"])
print("kappa", OUT["kappa"]["k3"])
