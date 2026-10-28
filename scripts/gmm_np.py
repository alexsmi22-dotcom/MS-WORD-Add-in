"""
Independent numpy implementation of linear GMM (two-step efficient, as linearmodels IVGMM) and of Arellano-Bond
difference / Blundell-Bond system GMM (as Roodman's xtabond2 defines them: H matrices (22) and (26), GMM-style
instruments "missing = 0", IV-style columns transformed in the difference equation and stacked per (24) in system
GMM, generalized inverses, Windmeijer (2005) correction, Arellano-Bond AR(m) test as Roodman (2009) section 3.5).

Used by scripts/gmm-oracle.py (fixtures for src/lib/__tests__/gmm.test.ts) as the third check beside linearmodels
and pydynpd. Plain numpy, no pandas.
"""
import math
import numpy as np

EPS = np.finfo(float).eps


def pinv_sym(a):
    """
    Generalized inverse of a symmetric PSD matrix, equilibrated as the engine's symInverse: with d = sqrt(diag a),
    b = a / (d d^T) has a unit diagonal; its Moore-Penrose inverse (eigenvalues <= n * eps * max dropped) is
    unscaled by the same d. A nonsingular matrix gets its exact inverse; the convention only matters when the matrix
    is singular, and it makes the result invariant to rescaling any variable (raw Moore-Penrose is not).
    """
    a = (a + a.T) / 2
    dg = np.diag(a).copy()
    s = np.where(dg > 0, 1.0 / np.sqrt(np.where(dg > 0, dg, 1.0)), 0.0)
    b = a * np.outer(s, s)
    w, v = np.linalg.eigh(b)
    m = np.max(np.abs(w)) if w.size else 0.0
    keep = np.abs(w) > EPS * m * b.shape[0] if m > 0 else np.zeros_like(w, dtype=bool)
    winv = np.zeros_like(w)
    winv[keep] = 1.0 / w[keep]
    return ((v * winv) @ v.T) * np.outer(s, s)


def col_rank(m):
    """Rank of a matrix after scaling each nonzero column to unit norm (a unit-free decision)."""
    nrm = np.sqrt((m * m).sum(0))
    keep = nrm > 0
    if not keep.any():
        return 0
    return int(np.linalg.matrix_rank(m[:, keep] / nrm[keep]))


# ------------------------------------------------------------------------------------------------ linear GMM


def linear_gmm(y, X, Z, clusters=None, steps=2):
    """y (n), X (n x k), Z (n x L). Returns dict: b2sls, b, cov, j, jdf, and the 2SLS robust covariance."""
    n = len(y)
    W0 = np.linalg.inv(Z.T @ Z / n)

    def est(W):
        xz = X.T @ Z / n
        zy = Z.T @ y / n
        return np.linalg.solve(xz @ W @ xz.T, xz @ W @ zy)

    def S_of(e):
        ze = Z * e[:, None]
        if clusters is None:
            return ze.T @ ze / n
        g = {}
        for i, c in enumerate(clusters):
            g.setdefault(c, np.zeros(Z.shape[1]))
            g[c] = g[c] + ze[i]
        M = np.array(list(g.values()))
        return M.T @ M / n

    def cov(W, e):
        xz = X.T @ Z / n
        A = np.linalg.inv(xz @ W @ xz.T)
        c = A @ (xz @ W @ S_of(e) @ W @ xz.T) @ A / n
        return (c + c.T) / 2

    b1 = est(W0)
    e1 = y - X @ b1
    out = {"b2sls": b1, "cov2sls": cov(W0, e1)}
    if steps == 1:
        out.update(b=b1, cov=cov(W0, e1), W=W0)
        return out
    S1 = S_of(e1)
    W = np.linalg.inv(S1)
    b = est(W)
    e = y - X @ b
    g = (Z * e[:, None]).mean(0)
    out.update(b=b, cov=cov(W, e), j=float(n * g @ W @ g), jdf=Z.shape[1] - X.shape[1], W=W)
    return out


# ------------------------------------------------------------------------------------------------ dynamic panels


def _dummy_terms(T):
    return [("__yr", s) for s in range(T)]


def build(ids, times, data, spec):
    """
    ids, times (int periods), data: dict name -> array (NaN = missing). spec:
      y: name; ylags: [1] or [1,2]; xterms: [(name, lag), ...] exogenous; endog: [(name, lag), ...] GMM-style
      regressors; gmm: [(name, a, b)] instruments: levels lags a..b (b None = all) for the difference equation and the
      difference dated a-1 for the levels equation; system: bool; timedummies: bool; collapse: bool.
    Returns per-group blocks and names.
    """
    uid = sorted(set(ids))
    t0 = int(min(times))
    T = int(max(times)) - t0 + 1
    grid = {}
    for nm, col in data.items():
        g = {u: np.full(T, np.nan) for u in uid}
        for i in range(len(ids)):
            g[ids[i]][int(times[i]) - t0] = col[i]
        grid[nm] = g

    def val(nm, u, t):
        if nm == "__yr":
            raise ValueError
        if t < 0 or t >= T:
            return np.nan
        return grid[nm][u][t]

    yname = spec["y"]
    terms = [(yname, l) for l in spec["ylags"]] + list(spec.get("endog", [])) + list(spec.get("xterms", []))
    names = [f"L{l}.{n}" if l else n for n, l in terms]
    system = spec.get("system", False)
    td = spec.get("timedummies", False)

    def lev_row(u, t):
        yv = val(yname, u, t)
        xs = [val(n, u, t - l) for n, l in terms]
        return yv, xs

    groups = []
    diff_periods = set()
    lev_periods = set()
    for u in uid:
        drows, lrows = [], []
        for t in range(T):
            y1, x1 = lev_row(u, t)
            ok1 = not (np.isnan(y1) or any(np.isnan(x1)))
            if ok1:
                lrows.append(t)
                y0, x0 = lev_row(u, t - 1)
                if not (np.isnan(y0) or any(np.isnan(x0))):
                    drows.append(t)
        groups.append((u, drows, lrows if system else []))
        diff_periods.update(drows)
        if system:
            lev_periods.update(lrows)
    # GMM columns
    gmm = spec["gmm"]
    collapse = spec.get("collapse", False)
    zkeys = []
    for gi, (nm, a, b) in enumerate(gmm):
        bb = b if b is not None else T
        for a_ in range(a, bb + 1):
            if collapse:
                zkeys.append(("gd", gi, a_, None))
            else:
                for t in sorted(diff_periods):
                    if t - a_ >= 0:
                        zkeys.append(("gd", gi, a_, t))
        if system:
            if collapse:
                zkeys.append(("gl", gi, a - 1, None))
            else:
                for t in sorted(lev_periods):
                    zkeys.append(("gl", gi, a - 1, t))
    ivterms = list(spec.get("xterms", []))
    for k_ in range(len(ivterms)):
        zkeys.append(("iv", k_, None, None))
    if td:
        # td_instr_from / td_eq exist only to mirror pydynpd's choice in the oracle (its dummies start at the first
        # difference period and instrument both equations); the calculator follows xtabond2 (level equation only).
        for s in range(spec.get("td_instr_from", 0), T):
            zkeys.append(("td", s, None, None))
    if system:
        zkeys.append(("cons", None, None, None))
    colnames = names + ([f"yr{s}" for s in range(T)] if td else []) + (["_cons"] if system else [])
    # Exact recentering of the instruments, as the engine's buildDynamic does it (it changes nothing when the weights
    # are nonsingular; with a singular weight the generalized inverse depends on the basis, so the oracle must use the
    # same one): difference GMM with time dummies subtracts, in the differenced rows of each period, the mean of each
    # GMM-style column's present values there; otherwise lag a of a GMM-style column becomes its difference from lag
    # a1 (missing = 0 on both), and in system GMM with time dummies, in a period where the groups with a differenced row
    # are exactly those with level rows at t and t - 1, the lag-a1 column also loses its period mean (later lags the
    # difference of the two means). IV-style columns lose their level-row mean in the level rows (system GMM).
    mu = {}
    for gi, (nm, a, b) in enumerate(gmm):
        bb = b if b is not None else T
        for a_ in range(a, bb + 1):
            for t in sorted(diff_periods):
                if not collapse and t - a_ < 0:
                    continue
                vals = [val(nm, u, t - a_) for u, drows, _ in groups if t in drows]
                vals = [v for v in vals if not np.isnan(v)]
                if vals:
                    mu[(gi, a_, t)] = float(np.mean(vals))
    dcount = {t: sum(1 for _, d, _ in groups if t in d) for t in range(T)}
    lcount = {t: sum(1 for _, _, l in groups if t in l) for t in range(T)}
    exact_t = {t: system and td and t >= 1 and dcount[t] > 0 and dcount[t] == lcount[t] == lcount[t - 1] for t in range(T)}
    # Level rows of the response and the terms lose their level-row means in system GMM (an exact reparametrization
    # absorbed by the constant, mapped back by unmap_constant), as the engine does, so large offsets stay accurate.
    lev_mean_y = 0.0
    lev_mean_x = np.zeros(len(terms))
    if system:
        lr_all = [(u, t) for u, _, lr in groups for t in lr]
        if lr_all:
            lev_mean_y = float(np.mean([val(yname, u, t) for u, t in lr_all]))
            lev_mean_x = np.array([np.mean([val(n, u, t - l) for u, t in lr_all]) for n, l in terms])
    ivmean = {}
    if system:
        for k_, (nm, l) in enumerate(spec.get("xterms", [])):
            ivmean[k_] = float(np.mean([val(nm, u, t - l) for u, _, lr in groups for t in lr]))

    def gd_value(gi, a_, u, t):
        nm, a1 = gmm[gi][0], gmm[gi][1]
        v = val(nm, u, t - a_)
        z = 0.0 if np.isnan(v) else v
        m = mu.get((gi, a_, t), 0.0)
        if td and not system:
            return z - m
        ex = exact_t[t]
        if a_ == a1:
            return z - (m if ex else 0.0)
        v1 = val(nm, u, t - a1)
        z1 = 0.0 if np.isnan(v1) else v1
        return z - z1 - ((m - mu.get((gi, a1, t), 0.0)) if ex else 0.0)
    blocks = []
    for u, drows, lrows in groups:
        nd, nl = len(drows), len(lrows)
        m = nd + nl
        if m == 0:
            continue
        X = np.zeros((m, len(colnames)))
        y = np.zeros(m)
        for r, t in enumerate(drows):
            y1, x1 = lev_row(u, t)
            y0, x0 = lev_row(u, t - 1)
            y[r] = y1 - y0
            X[r, : len(terms)] = np.array(x1) - np.array(x0)
            if td:
                X[r, len(terms) + t] += 1
                X[r, len(terms) + t - 1] -= 1
        for r, t in enumerate(lrows):
            y1, x1 = lev_row(u, t)
            y[nd + r] = y1 - lev_mean_y
            X[nd + r, : len(terms)] = np.array(x1) - lev_mean_x
            if td:
                X[nd + r, len(terms) + t] = 1
            X[nd + r, -1] = 1.0
        Z = np.zeros((m, len(zkeys)))
        for c, key in enumerate(zkeys):
            kind = key[0]
            if kind == "gd":
                _, gi, a_, tt = key
                nm = gmm[gi][0]
                for r, t in enumerate(drows):
                    if tt is not None and t != tt:
                        continue
                    Z[r, c] = gd_value(gi, a_, u, t)
            elif kind == "gl":
                _, gi, a_, tt = key
                nm = gmm[gi][0]
                for r, t in enumerate(lrows):
                    if tt is not None and t != tt:
                        continue
                    v = val(nm, u, t - a_) - val(nm, u, t - a_ - 1)
                    Z[nd + r, c] = 0 if np.isnan(v) else v
            elif kind == "iv":
                nm, l = ivterms[key[1]]
                for r, t in enumerate(drows):
                    Z[r, c] = val(nm, u, t - l) - val(nm, u, t - l - 1)
                for r, t in enumerate(lrows):
                    Z[nd + r, c] = val(nm, u, t - l) - ivmean.get(key[1], 0.0)
            elif kind == "td":
                s = key[1]
                if not system or spec.get("td_eq") == "both":
                    for r, t in enumerate(drows):
                        Z[r, c] = (1 if t == s else 0) - (1 if t - 1 == s else 0)
                if system:
                    for r, t in enumerate(lrows):
                        Z[nd + r, c] = 1 if t == s else 0
            elif kind == "cons":
                Z[nd:, c] = 1
        # H
        H = np.zeros((m, m))
        for r, t in enumerate(drows):
            H[r, r] = 2
            for r2, t2 in enumerate(drows):
                if abs(t2 - t) == 1:
                    H[r, r2] = -1
            for r2, t2 in enumerate(lrows):
                v = (1 if t2 == t else 0) - (1 if t2 == t - 1 else 0)
                H[r, nd + r2] = v
                H[nd + r2, r] = v
        for r in range(nl):
            H[nd + r, nd + r] = 1
        blocks.append(dict(u=u, X=X, y=y, Z=Z, H=H, nd=nd, drows=drows, lrows=lrows))
    # drop dummy / constant columns: all-zero first, then greedy collinearity (regressor terms first, constant kept)
    Xall = np.vstack([b["X"] for b in blocks])
    k0 = len(terms)
    keep = list(range(k0))
    order = ([len(colnames) - 1] if system else []) + (list(range(k0, k0 + T)) if td else [])
    dropped = []
    base = Xall[:, keep]
    for c in order:
        if not np.any(Xall[:, c] != 0):
            dropped.append(colnames[c])
            continue
        trial = np.column_stack([base, Xall[:, c]])
        if col_rank(trial) > col_rank(base):
            keep.append(c)
            base = trial
        else:
            dropped.append(colnames[c])
    keep_sorted = sorted(keep)
    for b in blocks:
        b["X"] = b["X"][:, keep_sorted]
    names_out = [colnames[c] for c in keep_sorted]
    shift = dict(my=lev_mean_y, mx={names[j]: float(lev_mean_x[j]) for j in range(len(terms))}) if system else None
    blocks[0]["shift"] = shift
    return blocks, names_out, dropped, t0


def unmap_constant(b, V, names, shift):
    """The constant of the recentered fit back on the raw columns: b_c + m_y - sum m_j b_j, Var = q^T V q."""
    if not shift or "_cons" not in names:
        return b, np.sqrt(np.diag(V))
    c = names.index("_cons")
    q = np.zeros(len(names))
    q[c] = 1.0
    for j, nm in enumerate(names):
        if nm in shift["mx"]:
            q[j] = -shift["mx"][nm]
    b2 = b.copy()
    b2[c] = q @ b + shift["my"]
    se = np.sqrt(np.diag(V)).copy()
    se[c] = math.sqrt(max(float(q @ V @ q), 0.0))
    return b2, se


def independent_columns(m, tol=1e-10):
    """
    Greedy column selection in order, as the engine's independentColumns: a column is kept when its squared distance
    from the span of the kept columns exceeds tol times its own squared norm (columns scaled to unit norm first).
    """
    nrm = np.sqrt((m * m).sum(0))
    kept = []
    basis = np.zeros((m.shape[0], 0))
    for j in range(m.shape[1]):
        if not nrm[j] > 0:
            continue
        v = m[:, j] / nrm[j]
        if basis.shape[1]:
            v = v - basis @ (basis.T @ v)
            v = v - basis @ (basis.T @ v)  # second pass for orthogonality
        r2 = float(v @ v)
        if r2 > tol:
            kept.append(j)
            basis = np.column_stack([basis, v / np.sqrt(r2)])
    return kept


def dpd(blocks, steps=2):
    # Linearly dependent instrument columns are dropped first, in order, as the engine does. With a nonsingular
    # two-step weight this changes nothing; with a singular one (more instruments than groups) the generalized inverse
    # depends on which columns are present, so the oracle must drop the same ones.
    keepz = independent_columns(np.vstack([b["Z"] for b in blocks]))
    blocks = [dict(b, Z=b["Z"][:, keepz]) for b in blocks]
    N = len(blocks)
    L = blocks[0]["Z"].shape[1]
    ZHZ = sum(b["Z"].T @ b["H"] @ b["Z"] for b in blocks)
    ZX = sum(b["Z"].T @ b["X"] for b in blocks)
    Zy = sum(b["Z"].T @ b["y"] for b in blocks)
    Zall = np.vstack([b["Z"] for b in blocks])
    ninstr = col_rank(Zall)
    k = ZX.shape[1]

    def gmm(A):
        M = pinv_sym(ZX.T @ A @ ZX)
        b = M @ ZX.T @ A @ Zy
        res = [bl["y"] - bl["X"] @ b for bl in blocks]
        return M, b, res

    A1 = pinv_sym(ZHZ)
    M1, b1, e1 = gmm(A1)
    zu1 = [bl["Z"].T @ e for bl, e in zip(blocks, e1)]
    S1 = sum(np.outer(z, z) for z in zu1)
    V1 = M1 @ ZX.T @ A1 @ S1 @ A1 @ ZX @ M1
    W2 = pinv_sym(S1)
    M2, b2, e2 = gmm(W2)
    zu2 = [bl["Z"].T @ e for bl, e in zip(blocks, e2)]
    g2 = sum(zu2)
    V2 = M2
    # Windmeijer
    D = np.zeros((k, k))
    c = W2 @ g2
    for j in range(k):
        acc = np.zeros(L)
        for bl, z1 in zip(blocks, zu1):
            a = bl["Z"].T @ bl["X"][:, j]
            acc += a * (z1 @ c) + z1 * (a @ c)
        D[:, j] = M2 @ ZX.T @ W2 @ acc
    Vc = V2 + D @ V2 + V2 @ D.T + D @ V1 @ D.T
    hansen = float(g2 @ W2 @ g2)
    g1 = sum(zu1)
    # Sargan: minimized one-step criterion scaled by sigma^2 from the one-step residuals
    nd = sum(bl["nd"] for bl in blocks)
    ed = np.concatenate([e[: bl["nd"]] for bl, e in zip(blocks, e1)])
    el = np.concatenate([e[bl["nd"]:] for bl, e in zip(blocks, e1)])
    sarg_raw = float(g1 @ A1 @ g1)

    def ar(res, A, M, V, m):
        out = []
        for lag in range(1, m + 1):
            d0 = 0.0
            d1 = 0.0
            EX = np.zeros(k)
            t3 = np.zeros(L)
            for bl, e in zip(blocks, res):
                ndi = bl["nd"]
                ed_ = e[:ndi]
                w = np.zeros(len(e))
                pos = {t: r for r, t in enumerate(bl["drows"])}
                for r, t in enumerate(bl["drows"]):
                    if t - lag in pos:
                        w[r] = ed_[pos[t - lag]]
                wu = w @ e
                d0 += wu
                d1 += wu * wu
                EX += w @ bl["X"]
                t3 += (bl["Z"].T @ e) * wu
            d2 = -2 * EX @ M @ ZX.T @ A @ t3
            d3 = EX @ V @ EX
            out.append(d0 / math.sqrt(d1 + d2 + d3))
        return out

    return dict(
        b1=b1, se1=np.sqrt(np.diag(V1)), b2=b2, se2=np.sqrt(np.diag(V2)), se2c=np.sqrt(np.diag(Vc)), V1=V1, V2=V2, Vc=Vc,
        hansen=hansen, df=ninstr - k, ninstr=ninstr, sarg_raw=sarg_raw, e1=e1, nd=nd, ed=ed, el=el,
        ar1=ar(e1, A1, M1, V1, 2), ar2=ar(e2, W2, M2, Vc, 2), N=N,
    )
