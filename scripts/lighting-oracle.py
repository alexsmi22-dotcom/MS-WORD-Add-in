"""
Oracle for src/lib/lightingPhysics.ts (Engineering > Lighting & rendering): writes
src/lib/__tests__/fixtures/lighting-oracle.json.

Run:  ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/lighting-oracle.py

Independence: nothing here imports or reads the TypeScript.
  - Sun: pvlib 0.16.1 NREL SPA ('nrel_numpy', pressure 101325 Pa, 12 C, delta_t from pvlib's own Espenak-Meeus fit)
    for elevation / apparent elevation / azimuth; sun_rise_set_transit_spa for sunrise, sunset and transit; golden and
    blue hour by scipy brentq on SPA's geometric elevation (no pvlib function exists for them).
  - BRDF: numpy GGX / Smith / Schlick written here from Walter 2007 and Heitz 2014; directional albedo integrated in
    (theta_l, phi_l) over the LIGHT direction with Gauss-Legendre x trapezoid (the TS integrates over the half-vector),
    and the GGX normalisation int D cos(theta_h) dw = 1 by scipy quad in theta_h.
  - Tone curves: the published formulas evaluated in numpy.
  - Atmosphere: pvlib get_relative_airmass('kastenyoung1989'); Rayleigh optical depth by the Bucholtz fit AND two other
    sources (Hansen & Travis 1974; Bird & Riordan 1986 as in pvlib spectrl2) to bound the formula's uncertainty;
    Henyey-Greenstein normalisation and mean cosine by quad.
  - Noise: the hemisphere-sampling variances by quad, not by the closed forms.
  - Disc illuminance: quad over the disc's solid angle.
"""
import json
import math
import os

import numpy as np
import pandas as pd
import pvlib
from scipy.integrate import quad
from scipy.optimize import brentq

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "__tests__", "fixtures", "lighting-oracle.json")


# ------------------------------------------------------------------------------------------------------------- sun
def sun_cases():
    sites = [
        ("London", 51.5074, -0.1278, 1),
        ("Sydney", -33.8688, 151.2093, 10),
        ("Quito", -0.1807, -78.4678, -5),
        ("Tromso", 69.6492, 18.9553, 1),
        ("Longyearbyen", 78.2232, 15.6267, 1),
        ("Singapore", 1.3521, 103.8198, 8),
        ("Los Angeles", 34.0522, -118.2437, -8),
        ("McMurdo", -77.846, 166.676, 13),
    ]
    dates = ["2026-03-20", "2026-06-21", "2026-09-23", "2026-12-21", "2024-02-29", "1990-07-04", "2075-11-11"]
    times = ["06:30:00", "09:15:00", "12:00:00", "15:45:00", "19:20:00", "23:50:00"]
    pos = []
    for name, lat, lon, off in sites:
        tz = "Etc/GMT%+d" % (-off) if off != 0 else "UTC"
        for d in dates:
            for t in times:
                ts = pd.DatetimeIndex([pd.Timestamp(d + " " + t)]).tz_localize(tz)
                sp = pvlib.solarposition.get_solarposition(ts, lat, lon, method="nrel_numpy", pressure=101325, temperature=12)
                pos.append({
                    "site": name, "lat": lat, "lon": lon, "offset": off, "date": d, "time": t,
                    "elevation": float(sp["elevation"].iloc[0]),
                    "apparent_elevation": float(sp["apparent_elevation"].iloc[0]),
                    "azimuth": float(sp["azimuth"].iloc[0]),
                    "eot": float(sp["equation_of_time"].iloc[0]),
                })
    return sites, dates, pos


def minutes_local(ts, day0):
    if pd.isna(ts):
        return None
    return (ts - day0).total_seconds() / 60.0


def sun_events(sites, dates):
    ev = []
    for name, lat, lon, off in sites:
        tz = "Etc/GMT%+d" % (-off) if off != 0 else "UTC"
        for d in dates:
            day0 = pd.Timestamp(d + " 00:00:00").tz_localize(tz)
            ts = pd.DatetimeIndex([pd.Timestamp(d + " 12:00:00")]).tz_localize(tz)
            r = pvlib.solarposition.sun_rise_set_transit_spa(ts, lat, lon)
            rise = minutes_local(r["sunrise"].iloc[0], day0)
            sset = minutes_local(r["sunset"].iloc[0], day0)
            transit = minutes_local(r["transit"].iloc[0], day0)

            def elev(m):
                t = pd.DatetimeIndex([day0 + pd.Timedelta(minutes=float(m))])
                return float(pvlib.solarposition.get_solarposition(t, lat, lon, method="nrel_numpy")["elevation"].iloc[0])

            # golden / blue: scan for brackets on a 2-minute grid around the local day, then brentq
            grid = np.arange(transit - 720, transit + 720.01, 2.0)
            tg = pd.DatetimeIndex([day0 + pd.Timedelta(minutes=float(m)) for m in grid])
            e = pvlib.solarposition.get_solarposition(tg, lat, lon, method="nrel_numpy")["elevation"].to_numpy()
            crosses = {}
            for h in (6.0, -0.8333, -4.0, -6.0):
                up, down = None, None
                for i in range(len(grid) - 1):
                    a, b = e[i] - h, e[i + 1] - h
                    if a < 0 <= b and up is None and grid[i] < transit:
                        up = brentq(lambda m: elev(m) - h, grid[i], grid[i + 1], xtol=1e-4)
                    if a >= 0 > b and down is None and grid[i] >= transit - 2:
                        down = brentq(lambda m: elev(m) - h, grid[i], grid[i + 1], xtol=1e-4)
                crosses[str(h)] = [up, down]
            ev.append({"site": name, "lat": lat, "lon": lon, "offset": off, "date": d,
                       "sunrise": rise, "sunset": sset, "transit": transit,
                       "max_elevation": float(e.max()), "min_elevation": float(e.min()), "crossings": crosses})
    return ev


# ------------------------------------------------------------------------------------------------------------ BRDF
def D_ggx(noh, a):
    a2 = a * a
    t = noh * noh * (a2 - 1) + 1
    return a2 / (math.pi * t * t)


def G1(nov, a):
    # Walter 2007 eq. 34 in the tan form: 2 / (1 + sqrt(1 + a^2 tan^2))
    if nov <= 0:
        return 0.0
    tan2 = (1 - nov * nov) / (nov * nov)
    return 2.0 / (1.0 + math.sqrt(1.0 + a * a * tan2))


def G2(nol, nov, a, form):
    if form == "separable":
        return G1(nol, a) * G1(nov, a)
    # Heitz 2014 eq. 99: 1 / (1 + Lambda(l) + Lambda(v)), Lambda = (-1 + sqrt(1 + a^2 tan^2)) / 2
    def lam(c):
        tan2 = (1 - c * c) / (c * c)
        return (-1 + math.sqrt(1 + a * a * tan2)) / 2
    return 1.0 / (1.0 + lam(nol) + lam(nov))


def schlick(F0, voh):
    return F0 + (1 - F0) * (1 - voh) ** 5


def brdf_point(r, metallic, ior, base, tv, tl, phi, form):
    a = max(r, 0.045) ** 2
    F0d = ((ior - 1) / (ior + 1)) ** 2
    F0 = (1 - metallic) * F0d + metallic * base
    v = np.array([math.sin(math.radians(tv)), 0.0, math.cos(math.radians(tv))])
    l = np.array([math.sin(math.radians(tl)) * math.cos(math.radians(phi)), math.sin(math.radians(tl)) * math.sin(math.radians(phi)), math.cos(math.radians(tl))])
    h = (v + l) / np.linalg.norm(v + l)
    nol, nov, noh, voh = l[2], v[2], h[2], float(v @ h)
    D = D_ggx(noh, a)
    G = G2(nol, nov, a, form)
    F = schlick(F0, voh)
    spec = D * G * F / (4 * nol * nov)
    return {"r": r, "metallic": metallic, "ior": ior, "base": base, "tv": tv, "tl": tl, "phi": phi, "form": form,
            "D": D, "G": G, "F": F, "F0": F0, "spec": spec}


def albedo(r, tv, F0, form, n_theta=400, n_phi=720):
    a = r * r
    v = np.array([math.sin(math.radians(tv)), 0.0, math.cos(math.radians(tv))])
    xs, ws = np.polynomial.legendre.leggauss(n_theta)
    # theta_l in (0, pi/2): mu = cos(theta_l) in (0, 1)
    mus = 0.5 * (xs + 1)
    wm = 0.5 * ws
    phis = np.linspace(0, 2 * math.pi, n_phi, endpoint=False)
    total = 0.0
    for mu, w in zip(mus, wm):
        s = math.sqrt(1 - mu * mu)
        acc = 0.0
        for ph in phis:
            l = np.array([s * math.cos(ph), s * math.sin(ph), mu])
            h = (v + l) / np.linalg.norm(v + l)
            noh, voh = h[2], float(v @ h)
            f = D_ggx(noh, a) * G2(mu, v[2], a, form) * schlick(F0, voh) / (4 * mu * v[2])
            acc += f * mu
        total += w * acc * (2 * math.pi / n_phi)
    return total


def d_norm(a):
    # int D(h) cos(theta_h) dw over the hemisphere, by quad in theta_h (phi gives 2 pi)
    val, _ = quad(lambda th: D_ggx(math.cos(th), a) * math.cos(th) * math.sin(th) * 2 * math.pi, 0, math.pi / 2, limit=400, points=[math.atan(a)])
    return val


# ------------------------------------------------------------------------------------------------------------- tone
def tone_cases():
    xs = [0.0, 0.01, 0.18, 0.5, 1.0, 2.0, 4.0, 5.6, 7.0, 11.2, 16.0, 100.0]
    A, B, C, D, E, F, W = 0.15, 0.5, 0.1, 0.2, 0.02, 0.3, 11.2

    def hp(x):
        return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F

    out = []
    for x in xs:
        out.append({
            "x": x,
            "reinhard": x / (1 + x),
            "reinhard_ext_4": x * (1 + x / 16.0) / (1 + x),
            "hable": hp(2 * x) / hp(W),
            "aces": float(np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1)),
        })
    return out


# ------------------------------------------------------------------------------------------------------- atmosphere
def bucholtz(lu):
    if lu <= 0.5:
        A, B, C, D = 6.50362e-3, 3.55212, 1.35579, 0.11563
    else:
        A, B, C, D = 8.64627e-3, 3.99668, 1.10298e-3, 2.71393e-2
    return A * lu ** (-(B + C * lu + D / lu))


def hansen_travis(lu):
    return 0.008569 * lu ** -4 * (1 + 0.0113 * lu ** -2 + 0.00013 * lu ** -4)


def bird_riordan(lu):
    return 1.0 / (lu ** 4 * (115.6406 - 1.3366 / lu ** 2))


def hg(g, th):
    return (1 - g * g) / (4 * math.pi * (1 + g * g - 2 * g * math.cos(th)) ** 1.5)


def main():
    sites, dates, pos = sun_cases()
    ev = sun_events(sites, dates)

    brdf_pts = []
    for args in [
        (0.5, 0.0, 1.5, 0.8, 45, 45, 180, "correlated"),
        (0.5, 0.0, 1.5, 0.8, 45, 45, 180, "separable"),
        (0.2, 0.0, 1.33, 0.5, 30, 30, 180, "correlated"),
        (0.2, 0.0, 1.33, 0.5, 30, 50, 150, "correlated"),
        (0.8, 1.0, 1.5, 0.95, 60, 20, 90, "correlated"),
        (0.3, 0.5, 1.6, 0.7, 85, 85, 180, "correlated"),
        (0.0, 0.0, 1.5, 0.8, 10, 10, 180, "correlated"),
        (1.0, 0.0, 2.4, 0.2, 0, 70, 0, "separable"),
    ]:
        brdf_pts.append(brdf_point(*args))
    alb = []
    for r in (0.3, 0.5, 0.7, 1.0):
        for tv in (0.0, 60.0, 80.0):
            for form in ("correlated", "separable"):
                alb.append({"r": r, "tv": tv, "F0": 1.0, "form": form, "E": albedo(r, tv, 1.0, form)})
        alb.append({"r": r, "tv": 45.0, "F0": 0.04, "form": "correlated", "E": albedo(r, 45.0, 0.04, "correlated")})
    dn = [{"alpha": a, "norm": d_norm(a)} for a in (0.002025, 0.01, 0.1, 0.5, 1.0)]

    zen = [0.0, 30.0, 60.0, 75.0, 85.0, 88.0, 90.0]
    am = pvlib.atmosphere.get_relative_airmass(np.array(zen), model="kastenyoung1989")
    lams = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7]
    ray = [{"um": l, "bucholtz": bucholtz(l), "hansen_travis": hansen_travis(l), "bird_riordan": bird_riordan(l)} for l in lams]
    hgs = []
    for g in (-0.5, 0.0, 0.3, 0.76, 0.9):
        norm, _ = quad(lambda t: hg(g, t) * 2 * math.pi * math.sin(t), 0, math.pi, limit=200)
        mean, _ = quad(lambda t: hg(g, t) * math.cos(t) * 2 * math.pi * math.sin(t), 0, math.pi, limit=200)
        hgs.append({"g": g, "p0": hg(g, 0), "p90": hg(g, math.pi / 2), "p180": hg(g, math.pi), "p30": hg(g, math.radians(30)), "norm": norm, "mean_cos": mean})

    noise = []
    for beta in (10.0, 30.0, 60.0, 89.0, 90.0):
        b = math.radians(beta)
        I, _ = quad(lambda t: math.cos(t) * math.sin(t) * 2 * math.pi, 0, b)
        # uniform: Y = 2 pi cos(t) on t < b; pdf over t is sin t
        m2u, _ = quad(lambda t: (2 * math.pi * math.cos(t)) ** 2 * math.sin(t), 0, b)
        # cosine: Y = pi on t < b; pdf over t is 2 sin t cos t
        m2c, _ = quad(lambda t: math.pi ** 2 * 2 * math.sin(t) * math.cos(t), 0, b)
        noise.append({"beta": beta, "I": I, "var_uniform": m2u - I * I, "var_cosine": m2c - I * I})

    disc = []
    for R, z in ((0.5, 1.0), (0.5, 5.0), (0.25, 2.5), (1.0, 0.1)):
        Lr = 1000.0
        th = math.atan(R / z)
        E, _ = quad(lambda t: Lr * math.cos(t) * math.sin(t) * 2 * math.pi, 0, th)
        disc.append({"L": Lr, "R": R, "z": z, "E": E, "E_point": Lr * math.pi * R * R / (z * z)})

    out = {
        "generator": "scripts/lighting-oracle.py",
        "pvlib": pvlib.__version__,
        "sun_positions": pos,
        "sun_events": ev,
        "brdf_points": brdf_pts,
        "albedo": alb,
        "d_norm": dn,
        "tone": tone_cases(),
        "kasten_young": [{"zenith": z, "am": float(a)} for z, a in zip(zen, am)],
        "rayleigh": ray,
        "hg": hgs,
        "noise": noise,
        "disc": disc,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", OUT, len(pos), "positions", len(ev), "event days")


if __name__ == "__main__":
    main()
