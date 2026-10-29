# Independent oracle for the Spaceflight & missions engines (spaceOrbit.ts, spaceMissions.ts, spaceEnvironment.ts).
#
#   C:\Users\AlexanderSmith\jurislab-oracle-venv\Scripts\python.exe -I scripts/spaceflight-oracle.py DE421_BSP OUT_JSON
#
# Run from OUTSIDE the repo (python -I). Written separately from the TypeScript: different algorithms where one exists
# (numerical integration with scipy's DOP853 for propagation and for checking every Lambert solution; numpy polynomial
# roots of the quintic for the collinear Lagrange points; brentq on the direct Δv comparison for the bi-elliptic
# thresholds; DE421 through skyfield for the planet positions), the same closed forms only where the closed form IS the
# definition (Allen–Eggers, Sutton–Graves, J2 secular rates, Wertz coverage). The constants are re-read from
# src/lib/spaceConstants.ts's generated block so both sides use the same GM, radius and density table.

import json
import math
import re
import sys
from pathlib import Path

import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import brentq

HERE = Path(__file__).resolve().parent
SRC = (HERE.parent / "src" / "lib" / "spaceConstants.ts").read_text(encoding="utf-8")


def ts_record(name):
    m = re.search(r"export const " + name + r"[^=]*= \{(.*?)\n\};", SRC, re.S)
    out = {}
    for k, v in re.findall(r"^\s+(\w+): ([-0-9.e+]+),", m.group(1), re.M):
        out[k] = float(v)
    return out


GM = ts_record("GM_SI")
REQ = ts_record("R_EQ_SI")
RMEAN = ts_record("R_MEAN_SI")
J2E = ts_record("J2")["earth"]
AU = 149597870700.0
DAY = 86400.0
STAND = {}
for k, el, rate in re.findall(r"^\s+(\w+): \{ el: \[([^\]]*)\], rate: \[([^\]]*)\]", SRC, re.M):
    STAND[k] = ([float(x) for x in el.split(",")], [float(x) for x in rate.split(",")])
MSIS_ALT = [float(x) for x in re.search(r"MSIS_ALT_KM = \[([^\]]*)\]", SRC).group(1).split(",")]
MSIS = {k: [float(x) for x in v.split(",")] for k, v in re.findall(r"^\s+(low|moderate|high): \[([^\]]*)\]", SRC, re.M)}
OMEGA_E = 7.292115e-5
SUN_RATE = 2 * math.pi / (365.2421897 * DAY)

mu_e = GM["earth"]
out = {}


# ---------------------------------------------------------------- two-body integration (the reference propagator)
def integrate(mu, r0, v0, t, rtol=1e-13):
    def f(_t, y):
        r = y[:3]
        return np.concatenate([y[3:], -mu * r / np.linalg.norm(r) ** 3])

    s = solve_ivp(f, (0, t), np.concatenate([r0, v0]), method="DOP853", rtol=rtol, atol=1e-9 * np.linalg.norm(r0))
    return s.y[:3, -1], s.y[3:, -1]


# ---------------------------------------------------------------- elements <-> state (Vallado RV2COE / COE2RV)
def coe2rv(mu, p, e, i, O, w, nu):
    r_pf = np.array([p * math.cos(nu) / (1 + e * math.cos(nu)), p * math.sin(nu) / (1 + e * math.cos(nu)), 0])
    v_pf = np.array([-math.sqrt(mu / p) * math.sin(nu), math.sqrt(mu / p) * (e + math.cos(nu)), 0])

    def R3(a):
        return np.array([[math.cos(a), math.sin(a), 0], [-math.sin(a), math.cos(a), 0], [0, 0, 1]])

    def R1(a):
        return np.array([[1, 0, 0], [0, math.cos(a), math.sin(a)], [0, -math.sin(a), math.cos(a)]])

    Q = (R3(w) @ R1(i) @ R3(O)).T
    return Q @ r_pf, Q @ v_pf


def rv2coe(mu, r, v):
    rn, vn = np.linalg.norm(r), np.linalg.norm(v)
    h = np.cross(r, v)
    n = np.cross([0, 0, 1], h)
    ev = ((vn ** 2 - mu / rn) * r - np.dot(r, v) * v) / mu
    e = np.linalg.norm(ev)
    p = np.dot(h, h) / mu
    i = math.acos(h[2] / np.linalg.norm(h))
    O = math.acos(n[0] / np.linalg.norm(n)) if np.linalg.norm(n) > 0 else 0.0
    if n[1] < 0:
        O = 2 * math.pi - O
    w = math.acos(np.dot(n, ev) / (np.linalg.norm(n) * e))
    if ev[2] < 0:
        w = 2 * math.pi - w
    nu = math.acos(max(-1, min(1, np.dot(ev, r) / (e * rn))))
    if np.dot(r, v) < 0:
        nu = 2 * math.pi - nu
    a = 1 / (2 / rn - vn ** 2 / mu)
    return dict(p=p, e=e, i=i, O=O, w=w, nu=nu, a=a, h=np.linalg.norm(h), energy=vn ** 2 / 2 - mu / rn)


cases = {}
r, v = coe2rv(mu_e, (80000e6) ** 2 / mu_e, 1.4, math.radians(30), math.radians(40), math.radians(60), math.radians(30))
cases["curtis_4_7"] = dict(r=list(r), v=list(v))  # Curtis Example 4.7 (h = 80 000 km²/s, e = 1.4 ...)
el = rv2coe(mu_e, np.array([-6045e3, -3490e3, 2500e3]), np.array([-3.457e3, 6.618e3, 2.533e3]))
cases["curtis_4_3"] = {k: float(x) for k, x in el.items()}  # Curtis Example 4.3
# Molniya default of the calculator: a 26 600 km, e 0.74, i 63.4, O 40, w 270, nu 30; propagated 2 h by integration.
p_m = 26600e3 * (1 - 0.74 ** 2)
r0, v0 = coe2rv(mu_e, p_m, 0.74, math.radians(63.4), math.radians(40), math.radians(270), math.radians(30))
r1, v1 = integrate(mu_e, r0, v0, 7200)
cases["molniya"] = dict(r0=list(r0), v0=list(v0), r2h=list(r1), v2h=list(v1))
# Parabola, e = 1 exactly, rp = 7000 km, propagated 6000 s; and a hyperbola e = 2.5, rp = 7000 km, 5000 s back and forth.
rp_ = 7000e3
r0, v0 = coe2rv(mu_e, 2 * rp_, 1.0, 0.3, 0.2, 0.1, 0.0)
r1, v1 = integrate(mu_e, r0, v0, 6000)
cases["parabola"] = dict(r0=list(r0), v0=list(v0), r=list(r1), v=list(v1), t=6000)
r0, v0 = coe2rv(mu_e, rp_ * 3.5, 2.5, 1.2, 2.0, 0.7, -0.5)
r1, v1 = integrate(mu_e, r0, v0, 5000)
cases["hyperbola"] = dict(r0=list(r0), v0=list(v0), r=list(r1), v=list(v1), t=5000)
# Kepler's equation by brentq (Vallado Example 2-1: M = 235.4°, e = 0.4 gives E = 220.512074°).
E = brentq(lambda E: E - 0.4 * math.sin(E) - math.radians(235.4), 0, 2 * math.pi, xtol=1e-15)
cases["vallado_2_1_E_deg"] = math.degrees(E)
F = brentq(lambda F: 2.4 * math.sinh(F) - F - 40.69, 0, 10, xtol=1e-15)
cases["hyperbolic_F"] = F
out["orbit"] = cases


# ---------------------------------------------------------------- Lambert: universal variable by brentq, verified by integration
def stumpC(z):
    if z > 0:
        return (1 - math.cos(math.sqrt(z))) / z
    if z < 0:
        return (math.cosh(math.sqrt(-z)) - 1) / -z
    return 0.5


def stumpS(z):
    if z > 0:
        s = math.sqrt(z)
        return (s - math.sin(s)) / s ** 3
    if z < 0:
        s = math.sqrt(-z)
        return (math.sinh(s) - s) / s ** 3
    return 1 / 6


def lambert_py(mu, r1, r2, dt, longway=False, prograde=None):
    R1, R2 = np.linalg.norm(r1), np.linalg.norm(r2)
    c = np.cross(r1, r2)
    th = math.acos(np.dot(r1, r2) / (R1 * R2))
    if prograde is not None:
        if (prograde and c[2] < 0) or ((not prograde) and c[2] >= 0):
            th = 2 * math.pi - th
    elif longway:
        th = 2 * math.pi - th
    A = math.sin(th) * math.sqrt(R1 * R2 / (1 - math.cos(th)))

    def y(z):
        return R1 + R2 + A * (z * stumpS(z) - 1) / math.sqrt(stumpC(z))

    def F(z):
        yz = y(z)
        if yz < 0:
            return -dt
        return ((yz / stumpC(z)) ** 1.5 * stumpS(z) + A * math.sqrt(yz)) / math.sqrt(mu) - dt

    lo = -100.0
    while y(lo) < 0:
        lo /= 2
    hi = 4 * math.pi ** 2 - 1e-6
    z = brentq(F, lo, hi, xtol=1e-14, maxiter=500)
    yz = y(z)
    f = 1 - yz / R1
    g = A * math.sqrt(yz / mu)
    gd = 1 - yz / R2
    return (r2 - f * r1) / g, (gd * r2 - r1) / g, th


lam = {}
r1 = np.array([5000e3, 10000e3, 2100e3])
r2 = np.array([-14600e3, 2500e3, 7000e3])
v1, v2, th = lambert_py(mu_e, r1, r2, 3600)
rc, _ = integrate(mu_e, r1, v1, 3600)
lam["curtis_5_2"] = dict(v1=list(v1), v2=list(v2), dtheta=th, miss_m=float(np.linalg.norm(rc - r2)))
v1, v2, th = lambert_py(mu_e, r1, r2, 3600 * 5, longway=True)
rc, _ = integrate(mu_e, r1, v1, 3600 * 5)
lam["curtis_5_2_long_5h"] = dict(v1=list(v1), v2=list(v2), dtheta=th, miss_m=float(np.linalg.norm(rc - r2)))
v1, v2, th = lambert_py(mu_e, r1, r2, 1500)
rc, _ = integrate(mu_e, r1, v1, 1500)
lam["curtis_5_2_hyperbolic_25min"] = dict(v1=list(v1), v2=list(v2), dtheta=th, miss_m=float(np.linalg.norm(rc - r2)))
out["lambert"] = lam


# ---------------------------------------------------------------- Standish positions (python) and DE421 (skyfield)
def jd_of(y, mo, d):
    if mo <= 2:
        y -= 1
        mo += 12
    A = y // 100
    B = 2 - A + A // 4
    return math.floor(365.25 * (y + 4716)) + math.floor(30.6001 * (mo + 1)) + d + B - 1524.5


def standish_py(key, jd):
    el, rate = STAND[key]
    T = (jd - 2451545.0) / 36525
    a, e, I, L, wb, O = [el[k] + rate[k] * T for k in range(6)]
    w = wb - O
    M = math.radians((L - wb + 180) % 360 - 180)
    E = brentq(lambda E: E - e * math.sin(E) - M, M - 2, M + 2, xtol=1e-15)
    xp, yp = a * (math.cos(E) - e), a * math.sqrt(1 - e * e) * math.sin(E)
    n = math.sqrt(GM["sun"] / (a * AU) ** 3)
    Ed = n / (1 - e * math.cos(E))
    vxp, vyp = -a * AU * math.sin(E) * Ed, a * AU * math.sqrt(1 - e * e) * math.cos(E) * Ed
    w, O, I = map(math.radians, (w, O, I))
    cw, sw, cO, sO, cI, sI = math.cos(w), math.sin(w), math.cos(O), math.sin(O), math.cos(I), math.sin(I)
    R = np.array([[cw * cO - sw * sO * cI, -sw * cO - cw * sO * cI], [cw * sO + sw * cO * cI, -sw * sO + cw * cO * cI], [sw * sI, cw * sI]])
    return R @ np.array([xp, yp]) * AU, R @ np.array([vxp, vyp])


eph = {}
de = None
if len(sys.argv) > 1:
    from skyfield.api import load_file, load

    de = load_file(sys.argv[1])
    ts = load.timescale(builtin=True)
eps = math.radians(84381.448 / 3600)
rotx = np.array([[1, 0, 0], [0, math.cos(eps), math.sin(eps)], [0, -math.sin(eps), math.cos(eps)]])
names = {"mercury": "mercury barycenter", "venus": "venus barycenter", "emb": "earth barycenter", "mars": "mars barycenter", "jupiter": "jupiter barycenter", "saturn": "saturn barycenter", "uranus": "uranus barycenter", "neptune": "neptune barycenter"}
dates = [(1900, 1, 1), (1950, 6, 15), (2000, 1, 1), (2026, 10, 28), (2040, 3, 3)]
worst = {}
for key in names:
    errs = []
    for y, mo, d in dates:
        jd = jd_of(y, mo, d)
        r, _ = standish_py(key, jd)
        eph.setdefault(key, []).append(dict(jd=jd, r=list(r)))
        if de is not None:
            t = ts.tt_jd(jd)
            p = (de[names[key]].at(t).position.m - de["sun"].at(t).position.m)
            p_ecl = rotx @ p
            lon_s, lat_s = math.atan2(r[1], r[0]), math.asin(r[2] / np.linalg.norm(r))
            lon_d, lat_d = math.atan2(p_ecl[1], p_ecl[0]), math.asin(p_ecl[2] / np.linalg.norm(p_ecl))
            dl = (lon_s - lon_d + math.pi) % (2 * math.pi) - math.pi
            errs.append([abs(math.degrees(dl)) * 3600, abs(math.degrees(lat_s - lat_d)) * 3600, abs(np.linalg.norm(r) - np.linalg.norm(p_ecl)) / 1e6])
    if errs:
        worst[key] = [max(e[k] for e in errs) for k in range(3)]
out["standish"] = dict(positions=eph, de421_max_error_arcsec_arcsec_1000km=worst, jd_1800=jd_of(1800, 1, 1), jd_2050_12_31=jd_of(2050, 12, 31))


# ---------------------------------------------------------------- interplanetary
def hohmann_ip(dep, arr, park, capp, capa):
    r1, r2 = STAND[dep][0][0] * AU, STAND[arr][0][0] * AU
    mu = GM["sun"]
    at = (r1 + r2) / 2
    vinf1 = abs(math.sqrt(mu * (2 / r1 - 1 / at)) - math.sqrt(mu / r1))
    vinf2 = abs(math.sqrt(mu / r2) - math.sqrt(mu * (2 / r2 - 1 / at)))
    pd = "earth" if dep == "emb" else dep
    rp = REQ[pd] + park
    dv1 = math.sqrt(vinf1 ** 2 + 2 * GM[pd] / rp) - math.sqrt(GM[pd] / rp)
    rcp, rca = REQ[arr] + capp, REQ[arr] + capa
    ac = (rcp + rca) / 2
    dv2 = math.sqrt(vinf2 ** 2 + 2 * GM[arr] / rcp) - math.sqrt(GM[arr] * (2 / rcp - 1 / ac))
    T1, T2 = 2 * math.pi * math.sqrt(r1 ** 3 / mu), 2 * math.pi * math.sqrt(r2 ** 3 / mu)
    return dict(tof_days=math.pi * math.sqrt(at ** 3 / mu) / DAY, c3=vinf1 ** 2, dv_dep=dv1, dv_cap=dv2, synodic_days=1 / abs(1 / T1 - 1 / T2) / DAY)


ip = dict(earth_mars=hohmann_ip("emb", "mars", 300e3, 400e3, 400e3), earth_venus=hohmann_ip("emb", "venus", 200e3, 300e3, 300e3), earth_jupiter=hohmann_ip("emb", "jupiter", 300e3, 5000e3, 5000e3))
# Porkchop cells: Earth (EMB row) to Mars, prograde Lambert, Standish positions; and DE421 at the same cells.
cells = []
jd0 = jd_of(2026, 9, 1)
for dd, tf in [(60.0, 295.0), (0.0, 200.0), (100.0, 250.0), (150.0, 330.0), (60.0, 150.0)]:
    rd, vd = standish_py("emb", jd0 + dd)
    ra, va = standish_py("mars", jd0 + dd + tf)
    v1, v2, _ = lambert_py(GM["sun"], rd, ra, tf * DAY, prograde=True)
    c = dict(dep_days=dd, tof_days=tf, c3=float(np.linalg.norm(v1 - vd) ** 2), vinf_arr=float(np.linalg.norm(v2 - va)))
    if de is not None:
        t1, t2 = ts.tt_jd(jd0 + dd), ts.tt_jd(jd0 + dd + tf)
        e1 = de["earth barycenter"].at(t1) - de["sun"].at(t1)
        m2 = de["mars barycenter"].at(t2) - de["sun"].at(t2)
        rd2, vd2 = rotx @ e1.position.m, rotx @ (e1.velocity.km_per_s * 1000)
        ra2, va2 = rotx @ m2.position.m, rotx @ (m2.velocity.km_per_s * 1000)
        w1, w2, _ = lambert_py(GM["sun"], rd2, ra2, tf * DAY, prograde=True)
        c["c3_de421"] = float(np.linalg.norm(w1 - vd2) ** 2)
    cells.append(c)
ip["porkchop_cells"] = cells
out["interplanetary"] = ip


# ---------------------------------------------------------------- lunar patched conic (independent code)
def lunar(park, D, tof, llo, landing=True):
    muE, muM, RE, RM = GM["earth"], GM["moon"], REQ["earth"], REQ["moon"]
    r0 = RE + park

    def t_to(vp):
        h = r0 * vp
        p = h * h / muE
        e = p / r0 - 1
        nu = math.acos((p / D - 1) / e)
        if e < 1:
            a = p / (1 - e * e)
            E = 2 * math.atan(math.sqrt((1 - e) / (1 + e)) * math.tan(nu / 2))
            return (E - e * math.sin(E)) / math.sqrt(muE / a ** 3)
        a = p / (e * e - 1)
        F = 2 * math.atanh(math.sqrt((e - 1) / (e + 1)) * math.tan(nu / 2))
        return (e * math.sinh(F) - F) / math.sqrt(muE / a ** 3)

    vh = math.sqrt(muE * (2 / r0 - 2 / (r0 + D)))
    if tof is None:
        vp = vh
        tt = math.pi * math.sqrt(((r0 + D) / 2) ** 3 / muE)
    else:
        vp = brentq(lambda v: t_to(v) - tof, vh * (1 + 1e-9), 1.6 * math.sqrt(2 * muE / r0), xtol=1e-12)
        tt = tof
    vD = math.sqrt(vp ** 2 - 2 * muE / r0 + 2 * muE / D)
    vt = r0 * vp / D
    vr = math.sqrt(max(0.0, vD ** 2 - vt ** 2))
    vm = math.sqrt((muE + muM) / D)
    vinf = math.hypot(vt - vm, vr)
    rL = RM + llo
    loi = math.sqrt(vinf ** 2 + 2 * muM / rL) - math.sqrt(muM / rL)
    aD = (rL + RM) / 2
    desc = math.sqrt(muM / rL) - math.sqrt(muM * (2 / rL - 1 / aD)) + math.sqrt(muM * (2 / RM - 1 / aD))
    return dict(tli=vp - math.sqrt(muE / r0), tof_days=tt / DAY, vinf=vinf, loi=loi, descent_ideal=desc, soi=D * (muM / muE) ** 0.4)


out["lunar"] = dict(hohmann=lunar(185e3, 3.844e8, None, 110e3), three_day=lunar(185e3, 3.844e8, 3 * DAY, 110e3), apollo_like=lunar(185e3, 3.844e8, 3 * DAY, 110e3))


# ---------------------------------------------------------------- orbit changes
def hoh_n(R):
    return abs(math.sqrt(2 * R / (1 + R)) - 1) + abs(math.sqrt(1 / R) - math.sqrt(2 / (R * (1 + R))))


def bi_n(R, Rb):
    return (math.sqrt(2 * Rb / (1 + Rb)) - 1) + math.sqrt(2 / Rb) * abs(math.sqrt(R / (R + Rb)) - math.sqrt(1 / (1 + Rb))) + abs(math.sqrt(2 / R) * math.sqrt(Rb / (R + Rb)) - math.sqrt(1 / R))


th1 = brentq(lambda R: hoh_n(R) - (math.sqrt(2) - 1) * (1 + 1 / math.sqrt(R)), 5, 14, xtol=1e-14)
# R2: the ratio where d(bi-elliptic)/d(rb) at rb = r2 changes sign (numerical derivative of the three-burn cost).
th2 = brentq(lambda R: (bi_n(R, R * (1 + 1e-6)) - bi_n(R, R)) / (R * 1e-6), 14, 20, xtol=1e-10)
mu_ = GM["earth"]
r1g, r2g = REQ["earth"] + 400e3, REQ["earth"] + 35786e3
v1g, v2g = math.sqrt(mu_ / r1g), math.sqrt(mu_ / r2g)
atg = (r1g + r2g) / 2
vpg, vag = math.sqrt(mu_ * (2 / r1g - 1 / atg)), math.sqrt(mu_ * (2 / r2g - 1 / atg))
di = math.radians(28.5)
gto = dict(hohmann=(vpg - v1g) + (v2g - vag), combined_end=(vpg - v1g) + math.sqrt(vag ** 2 + v2g ** 2 - 2 * vag * v2g * math.cos(di)), separate_start=(vpg - v1g) + (v2g - vag) + 2 * v1g * math.sin(di / 2))
# Phasing 30° ahead in GEO in one revolution.
Tg = 2 * math.pi * math.sqrt(r2g ** 3 / mu_)
aph = (mu_ * (Tg * (1 - 30 / 360) / (2 * math.pi)) ** 2) ** (1 / 3)
gto["phasing_dv"] = 2 * abs(v2g - math.sqrt(mu_ * (2 / r2g - 1 / aph)))
out["maneuvers"] = dict(threshold_1=th1, threshold_2=th2, gto=gto)


# ---------------------------------------------------------------- J2, SSO, repeat, GEO
def j2r(a, e, i):
    n = math.sqrt(mu_e / a ** 3)
    p = a * (1 - e * e)
    k = 1.5 * n * J2E * (REQ["earth"] / p) ** 2
    return n, -k * math.cos(i), 0.75 * n * J2E * (REQ["earth"] / p) ** 2 * (5 * math.cos(i) ** 2 - 1), 0.75 * n * J2E * (REQ["earth"] / p) ** 2 * math.sqrt(1 - e * e) * (3 * math.cos(i) ** 2 - 1)


def sso_inc(h):
    a = REQ["earth"] + h
    return math.degrees(brentq(lambda i: j2r(a, 0, i)[1] - SUN_RATE, math.radians(90), math.radians(180)))


def revs_per_day(a, i):
    n, Od, wd, Md = j2r(a, 0, i)
    Tn = 2 * math.pi / (n + Md + wd)
    return 2 * math.pi / ((OMEGA_E - Od) * Tn)


i800 = math.radians(sso_inc(800e3))
alt_57_4 = brentq(lambda a: revs_per_day(a, i800) - 57 / 4, REQ["earth"] + 500e3, REQ["earth"] + 1200e3, xtol=1e-6) - REQ["earth"]
n8, Od8, wd8, _ = j2r(REQ["earth"] + 800e3, 0, i800)
ageo = (mu_e / OMEGA_E ** 2) ** (1 / 3)
out["j2"] = dict(sso_800_deg=sso_inc(800e3), sso_500_deg=sso_inc(500e3), sso_1000_deg=sso_inc(1000e3), raan_dot_800_deg_day=math.degrees(Od8) * DAY, argp_dot_800_deg_day=math.degrees(wd8) * DAY, repeat_57_4_alt_m=alt_57_4, critical_deg=math.degrees(math.acos(1 / math.sqrt(5))), geo_radius_m=ageo, geo_drift_50km_deg_day=math.degrees(-1.5 * 50e3 / ageo * OMEGA_E) * DAY, iss_raan_dot_deg_day=math.degrees(j2r(REQ["earth"] + 420e3, 0.0005, math.radians(51.64))[1]) * DAY)


# ---------------------------------------------------------------- CR3BP by quintic roots (numpy.roots)
def lpoints(mu):
    # L1 between (x = 1 - mu - g, g the distance from the secondary): g^5 - (3-mu) g^4 + (3-2mu) g^3 - mu g^2 + 2mu g - mu = 0
    g1 = [r.real for r in np.roots([1, -(3 - mu), 3 - 2 * mu, -mu, 2 * mu, -mu]) if abs(r.imag) < 1e-9 and 0 < r.real < 1][0]
    g2 = [r.real for r in np.roots([1, 3 - mu, 3 - 2 * mu, -mu, -2 * mu, -mu]) if abs(r.imag) < 1e-9 and r.real > 0][0]
    g3 = [r.real for r in np.roots([1, 2 + mu, 1 + 2 * mu, -(1 - mu), -2 * (1 - mu), -(1 - mu)]) if abs(r.imag) < 1e-9 and r.real > 0][0]
    x1, x2, x3 = 1 - mu - g1, 1 - mu + g2, -mu - g3

    def C(x, y):
        return x * x + y * y + 2 * (1 - mu) / math.hypot(x + mu, y) + 2 * mu / math.hypot(x - 1 + mu, y)

    return dict(x=[x1, x2, x3], C=[C(x1, 0), C(x2, 0), C(x3, 0), C(0.5 - mu, math.sqrt(3) / 2)])


tb = {}
for name, m1, m2, d in [("earth-moon", GM["earth"], GM["moon"], 3.844e8), ("sun-earth", GM["sun"], GM["earth"] + GM["moon"], STAND["emb"][0][0] * AU), ("sun-jupiter", GM["sun"], GM["jupiter"], STAND["jupiter"][0][0] * AU), ("equal", 1.0, 1.0, 1.0), ("pluto-charon-like", 1.0, 0.1218, 1.0)]:
    mu = m2 / (m1 + m2)
    L = lpoints(mu)
    tb[name] = dict(mu=mu, x=L["x"], C=L["C"], d=d, L1_from_primary_m=(L["x"][0] + mu) * d, L1_from_secondary_m=(1 - mu - L["x"][0]) * d, L2_from_secondary_m=(L["x"][1] - 1 + mu) * d, hill_m=d * (m2 / (3 * m1)) ** (1 / 3), soi_m=d * (m2 / m1) ** 0.4)
# Jacobi constant of the calculator's default state (Earth-Moon, x = 300 000 km, y = 0, v = (0, 0.1) km/s rotating).
em = tb["earth-moon"]
w = math.sqrt((GM["earth"] + GM["moon"]) / 3.844e8 ** 3)
xs, vys = 3e8 / 3.844e8, 100 / (w * 3.844e8)
mu = em["mu"]
tb["default_state_C"] = xs ** 2 + 2 * (1 - mu) / abs(xs + mu) + 2 * mu / abs(xs - 1 + mu) - vys ** 2
rhoE = GM["earth"] / 6.6743e-11 / (4 / 3 * math.pi * RMEAN["earth"] ** 3)
tb["roche_earth_rigid_3340_m"] = RMEAN["earth"] * (2 * rhoE / 3340) ** (1 / 3)
tb["roche_earth_fluid_3340_m"] = 2.44 * RMEAN["earth"] * (rhoE / 3340) ** (1 / 3)
out["three_body"] = tb


# ---------------------------------------------------------------- entry: closed form, and an integration on python's own US 1976 + the MSIS table
def us76(z):
    R0 = 6356766.0
    h = R0 * z / (R0 + z)
    layers = [(0, 288.15, -0.0065), (11000, 216.65, 0.0), (20000, 216.65, 0.001), (32000, 228.65, 0.0028), (47000, 270.65, 0.0), (51000, 270.65, -0.0028), (71000, 214.65, -0.002), (84852, 186.946, 0.0)]
    g0, M, Rs = 9.80665, 28.9644, 8314.32
    P = 101325.0
    for k in range(len(layers) - 1):
        hb, Tb, L = layers[k]
        top = layers[k + 1][0]
        hh = min(h, top)
        if L == 0:
            Pn = P * math.exp(-g0 * M * (hh - hb) / (Rs * Tb))
        else:
            Pn = P * (Tb / (Tb + L * (hh - hb))) ** (g0 * M / (Rs * L))
        if h <= top:
            T = Tb + L * (hh - hb)
            return Pn * M / (Rs * T)
        P = Pn
    return None


def rho_at(h, act="moderate"):
    km = h / 1000
    if km <= 84:
        return us76(h)
    if km < MSIS_ALT[0]:
        a = us76(84000.0)
        f = (km - 84) / (MSIS_ALT[0] - 84)
        return math.exp(math.log(a) * (1 - f) + math.log(MSIS[act][0]) * f)
    return math.exp(np.interp(km, MSIS_ALT, np.log(MSIS[act])))


beta, vE, gam, H, rho0, rn, k = 5000 / (1.3 * 12), 7800.0, math.radians(6), 7200.0, 1.225, 3.0, 1.7415e-4
hA = H * math.log(rho0 * H / (beta * math.sin(gam)))
aE = vE ** 2 * math.sin(gam) / (2 * math.e * H)
rhoQ = beta * math.sin(gam) / (3 * H)
vQ = vE * math.exp(-rhoQ * H / (2 * beta * math.sin(gam)))
qmax = k * math.sqrt(rhoQ / rn) * vQ ** 3


def entry_rhs(_t, y):
    r, v, g = y
    rho = rho_at(r - REQ["earth"]) or 0.0
    grav = mu_e / r ** 2
    return [v * math.sin(g), -rho * v * v / (2 * beta) - grav * math.sin(g), (v / r - grav / v) * math.cos(g)]


def hit(_t, y):
    return y[0] - REQ["earth"] - 1000.0


hit.terminal = True


def slow(_t, y):
    return y[1] - 100.0


slow.terminal = True
s = solve_ivp(entry_rhs, (0, 3000), [REQ["earth"] + 122e3, vE, -gam], method="DOP853", rtol=1e-10, atol=1e-6, events=[hit, slow], dense_output=True, max_step=0.5)
ts_ = np.linspace(0, s.t[-1], 60001)
Y = s.sol(ts_)
dec = [(rho_at(Y[0, j] - REQ["earth"]) or 0) * Y[1, j] ** 2 / (2 * beta) for j in range(len(ts_))]
jm = int(np.argmax(dec))
out["entry"] = dict(beta=beta, a_max_g=aE / 9.80665, h_amax_m=hA, v_amax=vE / math.sqrt(math.e), q_max_w_m2=qmax, h_qmax_m=H * math.log(3 * rho0 * H / (beta * math.sin(gam))), numeric_a_max_g=dec[jm] / 9.80665, numeric_h_amax_m=Y[0, jm] - REQ["earth"], numeric_v_amax=Y[1, jm], us76_50km=us76(50000.0), us76_0=us76(0.0))


# ---------------------------------------------------------------- decay: scipy quad of dt = da / adot
from scipy.integrate import quad

life = {}
for act in ("low", "moderate", "high"):
    f = lambda h: 1 / ((rho_at(h, act)) * math.sqrt(mu_e * (REQ["earth"] + h)) / beta)
    life[act] = quad(f, 120e3, 250e3, limit=400, epsrel=1e-8)[0] / DAY
life_cube = {}
for act in ("low", "moderate", "high"):
    b = 1.33 / (2.2 * 0.01)
    f = lambda h: 1 / ((rho_at(h, act)) * math.sqrt(mu_e * (REQ["earth"] + h)) / b)
    life_cube[act] = quad(f, 120e3, 400e3, limit=400, epsrel=1e-8)[0] / DAY
out["decay"] = dict(capsule_250km_days=life, cubesat_1u_400km_days=life_cube)


# ---------------------------------------------------------------- ground station (numpy, and astropy for the ellipsoid)
from astropy.coordinates import EarthLocation
import astropy.units as u


def ecef(lat, lon, h):
    loc = EarthLocation.from_geodetic(lon * u.deg, lat * u.deg, h * u.m, ellipsoid="WGS84")
    return np.array([loc.x.to_value(u.m), loc.y.to_value(u.m), loc.z.to_value(u.m)])


site = ecef(40.0, -105.0, 1600.0)
sat = ecef(45.0, -100.0, 550e3)
la, lo = math.radians(40.0), math.radians(-105.0)
enu_m = np.array([[-math.sin(lo), math.cos(lo), 0], [-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la)], [math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)]])
e_, n_, u_ = enu_m @ (sat - site)
rng = float(np.linalg.norm(sat - site))
Re = REQ["earth"]
h = 550e3
eps_ = math.radians(10)
eta = math.asin(Re * math.cos(eps_) / (Re + h))
lam_ = math.pi / 2 - eps_ - eta
nn = math.sqrt(mu_e / (Re + h) ** 3)
# Range rate at the edge of an overhead pass, by differentiating the range numerically along the pass.
rr = lambda lmb: math.sqrt(Re ** 2 + (Re + h) ** 2 - 2 * Re * (Re + h) * math.cos(lmb))
rdot = (rr(lam_ + 1e-7) - rr(lam_ - 1e-7)) / 2e-7 * nn
out["ground"] = dict(az_deg=math.degrees(math.atan2(e_, n_)) % 360, el_deg=math.degrees(math.asin(u_ / rng)), range_m=rng, lambda_deg=math.degrees(lam_), footprint_m=Re * lam_, max_pass_s=2 * lam_ / nn, range_rate_max=rdot, doppler_hz=2.25e9 * rdot / 299792458.0, slant_max_m=rr(lam_))


# ---------------------------------------------------------------- thermal
S = 1361.0
sig = 5.670374419e-8
qin = 0.3 * S * 1 + 0.3 * S * 0.3 * 0.3 * 1 + 0.8 * 237 * 0.3 * 1 + 100
out["thermal"] = dict(t_hot=(qin / (0.8 * sig * 6)) ** 0.25, t_cold=((0.8 * 237 * 0.3 + 100) / (0.8 * sig * 6)) ** 0.25, t_mars_black=(S / 1.52371034 ** 2 * 1 / (sig * 4)) ** 0.25)

json.dump(out, open(sys.argv[2], "w", encoding="utf-8"), indent=1, default=float)
print("written", sys.argv[2])
