"""
Oracle for Release F3 gap #19, GMM and dynamic panels (src/lib/gmm.ts, src/lib/gmmStatCalcs.ts).

Run:  ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/gmm-oracle.py [--abdata path/to/abdata.csv]
Writes src/lib/__tests__/fixtures/gmm-oracle.json.

Sources:
  econ-gmm       linearmodels 7.1 IVGMM (weight_type "robust" / "clustered", cov_type to match, debiased=False;
                 iter_limit=2 for two-step, 1 for one-step) and, as a cross-check that must agree to 1e-8, the
                 numpy implementation in scripts/gmm_np.py (linear_gmm); the first-stage partial R-squared and Wald
                 statistic from IVGMM's first_stage.diagnostics.
  panel-dyn-gmm  scripts/gmm_np.py (independent numpy implementation of Roodman's xtabond2 definitions), which
                 reproduces Roodman (2009, Stata Journal 9(1), pp. 111-118) abdata tables: one-step difference GMM
                 (Arellano-Bond 1991 table 4 col. a1, also its col. a2 two-step coefficients), the gmm(L.(n w k))
                 difference regression and the one-step system regression -- coefficients to 1e-6, robust SEs exactly
                 (the published B and C runs use Stata's "small", a factor sqrt((N_obs-1)/(N_obs-k) G/(G-1)) on the
                 SEs), AR(1)/AR(2), Sargan and Hansen to the printed digits. Run with --abdata to print that check
                 (abdata is not bundled: webuse abdata, saved as CSV id,year,n,w,k,ys).
                 pydynpd 0.2.2 (pip, PyPI) is run on every case it can express: no time dummies (its timedumm
                 parameterizes and instruments the dummies differently), and agrees with gmm_np on coefficients,
                 one-step robust and two-step Windmeijer SEs, Hansen J and the two-step AR tests. Its one-step AR
                 statistic is not used: pydynpd 0.2.2 forms it with the two-step moment vector (regression.py keeps
                 self._zs_list from the last GMM step), while Roodman's formula reproduces the published one-step
                 values. pydynpd needs two numpy-2 shims (np.in1d, and float()/math.sqrt of 1x1 arrays), applied
                 here without editing the package.

Every dataset is synthetic: the calculators' default tables ported bit for bit (32-bit LCG), and seeded numpy panels
rounded to the printed decimals, written into the fixture as the exact text the calculators read.
"""
import builtins
import importlib.util
import io
import contextlib
import json
import math
import os
import re
import sys
import types

import numpy as np

sys.dont_write_bytecode = True  # gmm_np is loaded by path; keep scripts/ free of __pycache__

if not hasattr(np, "in1d"):
    np.in1d = np.isin
import pandas as pd
from linearmodels.iv import IVGMM

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "lib", "__tests__", "fixtures", "gmm-oracle.json")
_spec = importlib.util.spec_from_file_location("gmm_np", os.path.join(ROOT, "scripts", "gmm_np.py"))
G = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(G)


def _shim_pydynpd():
    from pydynpd import regression
    import pydynpd.specification_tests as t
    import pydynpd.dynamic_panel_model as d
    import pydynpd.model_summary as s

    as_float = lambda x: builtins.float(np.asarray(x).reshape(-1)[0])
    for m in (t, d, s, regression):
        m.float = as_float
    t.math = types.SimpleNamespace(sqrt=lambda x: math.sqrt(as_float(x)))
    return regression


PYD = _shim_pydynpd()


# --------------------------------------------------------------------------------------------- default tables
def _lcg(seed):
    state = [seed]

    def u():
        state[0] = (state[0] * 1664525 + 1013904223) & 0xFFFFFFFF
        return (state[0] + 0.5) / 4294967296.0

    def gauss():
        s = 0.0
        for _ in range(12):
            s += u()
        return s - 6.0

    return u, gauss


def iv_default():
    """Port of ivCalcs.ts ivDefaultTable() (as scripts/econ-iv-oracle.py)."""
    u, gauss = _lcg(20261025)

    def fmt(k, d):
        sign = "-" if k < 0 else ""
        a = abs(k)
        if d == 0:
            return sign + str(a)
        p = 10 ** d
        return sign + str(a // p) + "." + str(a % p).rjust(d, "0")

    lines = ["lwage\teduc\texper\tdist\tsibs"]
    for _ in range(200):
        exper = 1 + math.floor(u() * 25)
        dist_t = math.floor(u() * 500)
        sibs = math.floor(u() * 7)
        ability = gauss()
        v = gauss()
        w = gauss()
        educ_x = 13.0 - 0.008 * dist_t - 0.4 * sibs + 0.8 * ability + 0.8 * v
        educ_k = math.floor(educ_x * 10 + 0.5)
        lw_x = 0.8 + 0.009 * educ_k + 0.025 * exper + 0.25 * ability + 0.3 * w
        lw_k = math.floor(lw_x * 1000 + 0.5)
        lines.append("\t".join([fmt(lw_k, 3), fmt(educ_k, 1), str(exper), fmt(dist_t, 1), str(sibs)]))
    return "\n".join(lines)


def dyn_default():
    """Port of gmmStatCalcs.ts dynDefaultTable()."""
    u, gauss = _lcg(19910415)

    def fmt3(v):
        kq = math.floor(v * 1000 + 0.5)
        sign = "-" if kq < 0 else ""
        a = abs(kq)
        return f"{sign}{a // 1000}.{str(a % 1000).rjust(3, '0')}"

    lines = ["firm\tyear\tsales\tprice"]
    for i in range(1, 61):
        eta = gauss()
        x = gauss()
        y = (eta + 0.3 * x) / (1 - 0.6) + gauss()
        for t in range(-5, 10):
            x = 0.5 * x + gauss()
            y = 0.6 * y + 0.3 * x + eta + gauss()
            if t < 0:
                continue
            xr = fmt3(x)
            yr = fmt3(y)
            if t > 0 and u() < 0.04:
                continue
            lines.append("\t".join([f"F{i:02d}", str(2012 + t), yr, xr]))
    return "\n".join(lines)


def read_table(text):
    rows = [l.split("\t") for l in text.strip().split("\n")]
    head = rows[0]
    cols = {h: [r[j] for r in rows[1:]] for j, h in enumerate(head)}
    return head, cols


# --------------------------------------------------------------------------------------------- synthetic panels
def synth_panel(seed, N, T, rho, gap=0.05, endog=True, start=2000):
    """y = rho y(-1) + 0.5 x - 0.3 z + eta + e; x endogenous (correlated with e), z exogenous; random gaps."""
    rng = np.random.default_rng(seed)
    lines = ["id\tt\ty\tx\tz"]
    for i in range(N):
        eta = rng.normal()
        y = eta / (1 - rho) + rng.normal()
        x = rng.normal()
        z = rng.normal()
        for t in range(-4, T):
            e = rng.normal()
            x = 0.4 * x + (0.5 * e if endog else 0) + rng.normal()
            z = 0.3 * z + rng.normal()
            y = rho * y + 0.5 * x - 0.3 * z + eta + e
            if t < 0:
                continue
            if t > 0 and rng.random() < gap:
                continue
            lines.append(f"g{i + 1}\t{start + t}\t{y:.4f}\t{x:.4f}\t{z:.4f}")
    return "\n".join(lines)


# --------------------------------------------------------------------------------------------- dynamic cases
def py_spec(fields):
    """The calculator's fields -> the gmm_np spec (the subset of syntax the cases use)."""
    dep, rhs = [s.strip() for s in fields["spec"].split("~")]
    terms = [s.strip() for s in rhs.split("+")]
    endog = [s.strip() for s in fields.get("endog", "").split("+") if s.strip()]
    ylags, xt, en = [], [], []
    for tm in terms:
        lag = 0
        name = tm
        if tm.startswith("L(") and ")." in tm:
            lo, hi = tm[2:tm.index(")")].split("/")
            name = tm[tm.index(").") + 2:]
            lst = list(range(int(lo), int(hi) + 1))
        elif re.match(r"^L\d*\.", tm):
            k = tm[1:tm.index(".")]
            lst = [int(k) if k else 1]
            name = tm[tm.index(".") + 1:]
        else:
            lst = [0]
        for lag in lst:
            if name == dep:
                ylags.append(lag)
            elif name in endog:
                en.append((name, lag))
            else:
                xt.append((name, lag))
    first = int(fields.get("lagFirst", "2") or "2")
    last = fields.get("lagLast", "")
    last = int(last) if last else None
    return dict(
        y=dep, ylags=sorted(ylags), endog=en, xterms=xt,
        gmm=[(dep, first, last)] + [(v, first, last) for v in endog],
        system=fields.get("estimator", "system") == "system",
        timedummies=fields.get("timeDummies", "yes") == "yes",
        collapse=fields.get("collapse", "no") == "yes",
    )


def run_np(text, fields):
    head, cols = read_table(text)
    ent, tim = fields["entity"], fields["time"]
    uniq = {}
    ids = [uniq.setdefault(v, len(uniq)) for v in cols[ent]]
    times = [int(v) for v in cols[tim]]
    data = {h: np.array([float(v) for v in cols[h]]) for h in head if h not in (ent, tim)}
    spec = py_spec(fields)
    blocks, names, dropped, t0 = G.build(ids, times, data, spec)
    shift = blocks[0].get("shift")
    r = G.dpd(blocks)
    r["b1"], r["se1"] = G.unmap_constant(r["b1"], r["V1"], names, shift)
    r["b2"], r["se2c"] = G.unmap_constant(r["b2"], r["Vc"], names, shift)
    _, r["se2"] = G.unmap_constant(r["b2"] * 0, r["V2"], names, shift)
    nobs = r["nd"] if not spec["system"] else sum(len(b["lrows"]) for b in blocks)
    nd = r["nd"]
    sig2 = float(r["ed"] @ r["ed"]) / (2 * nobs)
    return dict(
        names=names, dropped=[str(t0 + int(d[2:])) for d in dropped], L=r["ninstr"], df=r["df"], nObs=nobs, N=r["N"],
        b1=r["b1"].tolist(), se1=r["se1"].tolist(), b2=r["b2"].tolist(), se2=r["se2c"].tolist(), se2u=r["se2"].tolist(),
        hansen=r["hansen"], sargan=r["sarg_raw"] / sig2, ar1=[float(v) for v in r["ar1"]], ar2=[float(v) for v in r["ar2"]],
        nDiff=nd,
    )


def run_pydynpd(text, fields):
    head, cols = read_table(text)
    ent, tim = fields["entity"], fields["time"]
    df = pd.DataFrame({h: cols[h] for h in head})
    for h in head:
        if h != ent:
            df[h] = df[h].astype(float)
    df[tim] = df[tim].astype(int)
    df[ent] = pd.factorize(df[ent])[0] + 1
    spec = py_spec(fields)
    lagtxt = lambda lag, nm: nm if lag == 0 else f"L{lag}.{nm}"
    part1 = " ".join([spec["y"]] + [lagtxt(l, spec["y"]) for l in spec["ylags"]] + [lagtxt(l, n) for n, l in spec["endog"]] + [lagtxt(l, n) for n, l in spec["xterms"]])
    gm = " ".join(f"gmm({v}, {a}:{b if b is not None else '.'})" for v, a, b in spec["gmm"])
    iv = " ".join(lagtxt(l, n) for n, l in spec["xterms"])
    part2 = gm + (f" iv({iv})" if iv else "")
    opts = []
    if not spec["system"]:
        opts.append("nolevel")
    if spec["collapse"]:
        opts.append("collapse")
    out = {}
    for steps in ("onestep", ""):
        cmd = f"{part1} | {part2} | {' '.join(opts + ([steps] if steps else []))}".strip()
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            m = PYD.abond(cmd, df, [ent, tim]).models[0]
        st = m.step_results[0] if steps else m.step_results[1]
        key = "one" if steps else "two"
        out[key] = dict(b=st.beta.reshape(-1).tolist(), se=st.std_err.reshape(-1).tolist(), hansen=float(m.hansen.test_value), ar=[float(a.AR) for a in m.AR_list], L=int(m.z_information.num_instr), cmd=cmd)
    return out


def main():
    abpath = None
    if "--abdata" in sys.argv:
        abpath = sys.argv[sys.argv.index("--abdata") + 1]
    fixture = {"linear": [], "dynamic": [], "defaults": {"iv": iv_default(), "dyn": dyn_default()}}

    # ---- linear GMM
    ivt = iv_default()
    head, cols = read_table(ivt)
    ivdf = pd.DataFrame({h: [float(v) for v in cols[h]] for h in head})
    rng = np.random.default_rng(20261027)
    n = 300
    z1, z2, z3, w = rng.normal(size=(4, n))
    g = rng.integers(0, 25, n)
    u = rng.normal(size=n) * (1 + 0.8 * np.abs(z1))
    d1 = 0.8 * z1 + 0.5 * z2 + 0.5 * u + rng.normal(size=n)
    d2 = 0.6 * z3 - 0.4 * z2 + 0.4 * u + rng.normal(size=n)
    y = 1 + 0.5 * d1 - 0.7 * d2 + 0.3 * w + u
    syn = pd.DataFrame({"y": np.round(y, 4), "d1": np.round(d1, 4), "d2": np.round(d2, 4), "w": np.round(w, 4), "z1": np.round(z1, 4), "z2": np.round(z2, 4), "z3": np.round(z3, 4), "z4": np.round(z1 * z2, 4), "grp": g})
    syn_text = "\n".join(["\t".join(syn.columns)] + ["\t".join(f"{v:.4f}" if c != "grp" else f"G{int(v)}" for c, v in zip(syn.columns, row)) for row in syn.itertuples(index=False)])
    synf = syn.copy()
    lin_cases = [
        ("iv default, two-step robust", ivt, ivdf, dict(spec="lwage ~ exper", endog="educ", instruments="dist + sibs", constant="yes", steps="two", weight="robust", cluster="")),
        ("iv default, one-step robust", ivt, ivdf, dict(spec="lwage ~ exper", endog="educ", instruments="dist + sibs", constant="yes", steps="one", weight="robust", cluster="")),
        ("synthetic two endogenous, two-step robust", syn_text, synf, dict(spec="y ~ w", endog="d1 + d2", instruments="z1 + z2 + z3 + z4", constant="yes", steps="two", weight="robust", cluster="")),
        ("synthetic two endogenous, two-step clustered", syn_text, synf, dict(spec="y ~ w", endog="d1 + d2", instruments="z1 + z2 + z3 + z4", constant="yes", steps="two", weight="cluster", cluster="grp")),
        ("synthetic, no constant, two-step robust", syn_text, synf, dict(spec="y ~ w", endog="d1", instruments="z1 + z2", constant="no", steps="two", weight="robust", cluster="")),
    ]
    for label, text, df, f in lin_cases:
        dep = f["spec"].split("~")[0].strip()
        exog = [s.strip() for s in f["spec"].split("~")[1].split("+") if s.strip()]
        endog = [s.strip() for s in f["endog"].split("+")]
        ins = [s.strip() for s in f["instruments"].split("+")]
        X = df[endog + exog].copy()
        if f["constant"] == "yes":
            X["Constant"] = 1.0
        exo_df = df[exog].copy()
        if f["constant"] == "yes":
            exo_df["Constant"] = 1.0
        mod = IVGMM(df[dep], exo_df if exo_df.shape[1] else None, df[endog], df[ins], weight_type="clustered" if f["weight"] == "cluster" else "robust", **({"clusters": df["grp"]} if f["weight"] == "cluster" else {}))
        kw = dict(iter_limit=2 if f["steps"] == "two" else 1, cov_type="clustered" if f["weight"] == "cluster" else "robust", debiased=False)
        if f["weight"] == "cluster":
            kw["clusters"] = df["grp"]
        res = mod.fit(**kw)
        order = endog + exog + (["Constant"] if f["constant"] == "yes" else [])
        b = [float(res.params[nm]) for nm in order]
        se = [float(res.std_errors[nm]) for nm in order]
        # numpy cross-check
        Xn = X[order].to_numpy()
        Zn = np.column_stack([df[ins].to_numpy(), exo_df.to_numpy()]) if exo_df.shape[1] else df[ins].to_numpy()
        npres = G.linear_gmm(df[dep].to_numpy(), Xn, Zn, clusters=list(df["grp"]) if f["weight"] == "cluster" else None, steps=2)
        if f["steps"] == "two":
            assert np.allclose(npres["b"], b, rtol=1e-8, atol=1e-10), label
            assert np.allclose(np.sqrt(np.diag(npres["cov"])), se, rtol=1e-7), label
        else:
            assert np.allclose(npres["b2sls"], b, rtol=1e-8, atol=1e-10), label
            assert np.allclose(np.sqrt(np.diag(npres["cov2sls"])), se, rtol=1e-7), label
        # J of the two-step estimate (linearmodels' j_stat of an iter_limit=2 fit)
        kw2 = dict(kw, iter_limit=2)
        res2 = mod.fit(**kw2)
        j = float(res2.j_stat.stat)
        assert abs(j - npres["j"]) < 1e-7 * max(1, j), label
        tsls_b = npres["b2sls"].tolist()
        tsls_se = np.sqrt(np.diag(npres["cov2sls"])).tolist()
        # First-stage strength (linearmodels' first_stage.diagnostics, with the fit's covariance): partial R-squared
        # and the Wald statistic of the excluded instruments (chi2(q) for a robust or clustered covariance).
        diag = res.first_stage.diagnostics
        first = [dict(name=nm, partialR2=float(diag.loc[nm, "partial.rsquared"]), wald=float(diag.loc[nm, "f.stat"]), dist=str(diag.loc[nm, "f.dist"])) for nm in endog]
        fixture["linear"].append(dict(label=label, data=text if text is not ivt else "@iv-default", fields=f, names=order, b=b, se=se, j=j, jdf=int(res2.j_stat.df), tslsB=tsls_b, tslsSe=tsls_se, firstStage=first))
        print(f"linear {label}: b {np.round(b, 5)} J {j:.4f}")

    # ---- dynamic panels
    dt = dyn_default()
    base = dict(spec="sales ~ L.sales + price", entity="firm", time="year", endog="", estimator="system", steps="two", lagFirst="2", lagLast="4", collapse="no", timeDummies="yes")
    s1 = synth_panel(7, 80, 7, 0.5)
    sb = dict(spec="y ~ L.y + x + L.x + z", entity="id", time="t", endog="x", estimator="system", steps="two", lagFirst="2", lagLast="", collapse="no", timeDummies="no")
    s2 = synth_panel(11, 120, 9, 0.8, gap=0.08)
    dyn_cases = [
        ("default", dt, dict(base)),
        ("default, difference, all lags", dt, dict(base, estimator="difference", lagLast="")),
        ("default, system, collapse, no dummies", dt, dict(base, collapse="yes", timeDummies="no")),
        ("default, difference, lags 2 to 3, no dummies", dt, dict(base, estimator="difference", lagLast="3", timeDummies="no")),
        ("synthetic endogenous x, system", s1, dict(sb)),
        ("synthetic endogenous x, difference, collapse", s1, dict(sb, estimator="difference", collapse="yes")),
        ("synthetic endogenous x, system, time dummies", s1, dict(sb, timeDummies="yes")),
        ("synthetic rho 0.8, two lags of y, difference", s2, dict(sb, spec="y ~ L.y + L2.y + x + z", estimator="difference", lagLast="5")),
        ("synthetic rho 0.8, system, first lag 3", s2, dict(sb, spec="y ~ L.y + x + z", lagFirst="3", lagLast="5")),
        # More instruments than groups: the two-step weight is singular, so the generalized-inverse convention matters
        # (gmm_np and the calculator: Moore-Penrose of the unit-diagonal scaling). pydynpd inverts the unscaled matrix:
        # its numbers are recorded for the report, not asserted.
        ("default, endogenous price (singular two-step weight)", dt, dict(base, endog="price")),
        ("default, endogenous price, all lags, no dummies (singular two-step weight)", dt, dict(base, endog="price", lagLast="", timeDummies="no")),
    ]
    for label, text, f in dyn_cases:
        r = run_np(text, f)
        case = dict(label=label, data=text if text is not dt else "@dyn-default", fields=f, np=r)
        if "singular" in label:
            if f["timeDummies"] == "no":
                # NaN (pydynpd's SEs can be the square root of a negative variance here) is written as null.
                clean = lambda v: [clean(x) for x in v] if isinstance(v, list) else {k: clean(x) for k, x in v.items()} if isinstance(v, dict) else (None if isinstance(v, float) and v != v else v)
                case["pydynpdUnscaledInverse"] = clean(run_pydynpd(text, f))
        elif f["lagFirst"] != "2" and f["estimator"] == "system":
            # pydynpd starts the level equation at the first period its level instrument (dated a - 1) exists
            # (dynamic_panel_model.get_info: first_level_index = max(max_lag, a - 1)); xtabond2 keeps those rows
            # with the instrument "missing = 0". Different samples, so no pydynpd comparison here.
            case["pydynpdSkipped"] = "pydynpd trims the level sample to periods where the level instrument exists"
        elif f["timeDummies"] == "no":
            p = run_pydynpd(text, f)
            # agreement with gmm_np (non-dummy coefficients are all of them here)
            for key, b, se in (("one", r["b1"], r["se1"]), ("two", r["b2"], r["se2"])):
                assert np.allclose(p[key]["b"], b, rtol=1e-7, atol=1e-9), (label, key, p[key]["b"], b)
                assert np.allclose(p[key]["se"], se, rtol=1e-6, atol=1e-9), (label, key)
            assert abs(p["two"]["hansen"] - r["hansen"]) < 1e-6 * max(1, r["hansen"]), label
            assert np.allclose(p["two"]["ar"], r["ar2"], rtol=1e-6), label
            case["pydynpd"] = p
        fixture["dynamic"].append(case)
        print(f"dynamic {label}: L {r['L']} b2 {np.round(r['b2'][:3], 5)} hansen {r['hansen']:.3f}" + (" [pydynpd agrees]" if "pydynpd" in case else ""))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fixture, fh, indent=1)
    print("wrote", OUT)

    if abpath:
        head = open(abpath).read().strip().split("\n")
        text = "\n".join(l.replace(",", "\t") for l in head)
        A = dict(spec="n ~ L.n + L2.n + w + L.w + L(0/2).k + L(0/2).ys", entity="id", time="year", endog="", estimator="difference", lagFirst="2", lagLast="", collapse="no", timeDummies="yes")
        r = run_np(text, A)
        print("abdata (a1) L.n", r["b1"][0], "se", r["se1"][0], "AR", r["ar1"], "Sargan", r["sargan"], "Hansen", r["hansen"], "obs", r["nObs"], "instr", r["L"])
        print("  published: .6862261 (.1445943), AR -3.60 -0.52, Sargan 67.59, Hansen 31.38, 611 obs, 41 instruments; two-step L.n 0.629 (AB 1991 a2):", r["b2"][0])


if __name__ == "__main__":
    main()
