"""Oracle for the Astronomy & lunar engines (src/lib/astroTime.ts, astroCoords.ts, astroBodies.ts, astroMoon.ts,
astroPhysics.ts).

Run (from a directory OTHER than the repo):
  ~/jurislab-oracle-venv/Scripts/python.exe -I <repo>/scripts/astro-oracle.py <de421.bsp> <de440s.bsp> <out.json>
Writes the fixture the tests read: src/lib/__tests__/fixtures/astro-oracle.json.

Sources, by item:
  Positions   skyfield 1.55 with JPL DE421 (1900-2049) and DE440s (2050-2100, beyond DE421's range):
              earth.at(t).observe(body).apparent(), ecliptic of date (true equinox) and RA/Dec of date, at a TT the
              script chooses (the engines are fed the same TT, so a ΔT difference cannot pose as an error).
  Rise/set    skyfield almanac.find_risings / find_settings / find_transits at WGS84 sites, default horizons
              (Sun -0.8333 deg; Moon -34' minus its topocentric semidiameter from a 1737.1 km radius). Each event
              records skyfield's own TT and UT1 for it, so the engine is compared on the same time scales.
  Phases      skyfield almanac.moon_phases (apparent geocentric ecliptic longitude difference 0/90/180/270).
  Eclipses    skyfield eclipselib.lunar_eclipses (Danjon 1.01 enlargement); solar gamma from DE421 vectors (closest
              approach of the Sun-Moon shadow axis to the geocentre, in units of 6378.137 km).
  Time        erfa (pyerfa) gmst06, gst06a, era00, obl06, nut80, bp06 (precession only), dat (TAI-UTC);
              skyfield julian_calendar_cutoff for pre-1582 Julian Dates; skyfield ΔT (IERS) 1900-2024.
  Galactic    astropy SkyCoord ICRS -> Galactic.
  Magnitudes  skyfield magnitudelib.planetary_magnitude (Mallama & Hilton 2018).
  Cosmology   astropy FlatLambdaCDM(H0=67.7, Om0=0.31, Tcmb0=0).
"""
import json
import math
import sys

import numpy as np
import erfa
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.cosmology import FlatLambdaCDM
from skyfield import almanac, eclipselib
from skyfield.api import GREGORIAN_START, Star, load, load_file, wgs84
from skyfield.framelib import ecliptic_frame
from skyfield.magnitudelib import planetary_magnitude

de421 = load_file(sys.argv[1])
de440 = load_file(sys.argv[2])
OUT = sys.argv[3]
ts = load.timescale(builtin=True)
rng = np.random.default_rng(20261028)

J2050 = 2469807.5  # 2050-01-01 TT: DE421 ends 2053, DE440s used from here on


def eph_for(jd):
    return de421 if jd < J2050 else de440


def pos(eph, name, jd_tt):
    t = ts.tt_jd(jd_tt)
    app = eph['earth'].at(t).observe(eph[name]).apparent()
    lat, lon, dist = app.frame_latlon(ecliptic_frame)
    ra, dec, _ = app.radec(epoch='date')
    return {
        'lon': lon.degrees, 'lat': lat.degrees, 'ra': ra.hours * 15, 'dec': dec.degrees,
        'dist_km': dist.km,
    }


out = {}

# ---- positions: Moon, Sun, planets ----
jds = sorted(rng.uniform(2415020.5, 2488069.5, 400))  # 1900-01-01 .. 2100-01-01
out['moon'] = [dict(jd_tt=jd, **pos(eph_for(jd), 'moon', jd)) for jd in jds]
out['sun'] = [dict(jd_tt=jd, **pos(eph_for(jd), 'sun', jd)) for jd in jds[::2]]
PL = {'mercury': 'mercury', 'venus': 'venus', 'mars': 'mars barycenter', 'jupiter': 'jupiter barycenter',
      'saturn': 'saturn barycenter', 'uranus': 'uranus barycenter', 'neptune': 'neptune barycenter'}
planets = []
for jd in jds[::4]:
    eph = eph_for(jd)
    t = ts.tt_jd(jd)
    row = {'jd_tt': jd}
    for k, name in PL.items():
        p = pos(eph, name, jd)
        astrometric = eph['earth'].at(t).observe(eph[name])
        try:
            mag = float(planetary_magnitude(astrometric))
        except Exception:
            mag = None
        p['mag'] = None if mag is None or not math.isfinite(mag) else mag
        row[k] = p
    planets.append(row)
out['planets'] = planets

# ---- time scales ----
tsamp = sorted(rng.uniform(2415020.5, 2488069.5, 60))
times = []
for jd in tsamp:
    ut1 = jd
    tt = jd + 69.0 / 86400
    gmst = erfa.gmst06(ut1, 0.0, tt, 0.0)
    gast = erfa.gst06a(ut1, 0.0, tt, 0.0)
    era = erfa.era00(ut1, 0.0)
    eps = erfa.obl06(tt, 0.0)
    dpsi, deps = erfa.nut80(tt, 0.0)
    rb, rp, rbp = erfa.bp06(tt, 0.0)
    times.append({'ut1': ut1, 'tt': tt, 'gmst': gmst, 'gast': gast, 'era': era, 'eps0': eps, 'dpsi': dpsi,
                  'deps': deps, 'rp': rp.tolist()})
out['times'] = times

# TAI-UTC at dates 1972..2027
dat = []
for y in range(1972, 2027):
    for m in (1, 4, 7, 10):
        dat.append({'y': y, 'm': m, 'd': 15, 'dat': erfa.dat(y, m, 15, 0.0)})
out['dat'] = dat

# Julian Dates of calendar dates, Julian calendar before 1582-10-15 (skyfield julian_calendar_cutoff)
ts_j = load.timescale(builtin=True)
ts_j.julian_calendar_cutoff = GREGORIAN_START
cal = []
for (y, m, d, h) in [(-4712, 1, 1, 12), (-1000, 7, 12, 12), (-1000, 2, 29, 0), (-123, 12, 31, 0), (0, 1, 1, 0),
                     (333, 1, 27, 12), (837, 4, 10, 7.2), (1582, 10, 4, 0), (1582, 10, 15, 0), (1600, 1, 1, 0),
                     (1900, 1, 1, 0), (1957, 10, 4, 19.44), (2000, 1, 1, 12), (2026, 11, 5, 6), (-500, 3, 1, 0),
                     (1, 1, 1, 0), (-1, 12, 31, 0), (2100, 3, 1, 0), (1700, 2, 28, 0), (1582, 10, 3, 18)]:
    t = ts_j.tt(y, m, d, h)
    cal.append({'y': y, 'm': m, 'd': d, 'h': h, 'jd': float(t.tt)})
out['calendar'] = cal

# ΔT observed (skyfield's IERS-derived table), yearly
out['deltat'] = [{'year': y, 'dt': float((ts.tt(y, 7, 1).tt - ts.tt(y, 7, 1).ut1) * 86400)} for y in range(1900, 2025)]

# ---- precession/nutation already above; galactic ----
gal = []
for _ in range(40):
    ra = float(rng.uniform(0, 360))
    dec = float(np.degrees(np.arcsin(rng.uniform(-1, 1))))
    g = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame='icrs').galactic
    gal.append({'ra': ra, 'dec': dec, 'l': g.l.deg, 'b': g.b.deg})
out['galactic'] = gal

# ---- star alt/az (no refraction) at sites ----
SITES = [('greenwich', 51.4769, -0.0005), ('sydney', -33.8688, 151.2093), ('quito', -0.18, -78.47),
         ('fairbanks', 64.84, -147.72), ('longyearbyen', 78.22, 15.65), ('mcmurdo', -77.85, 166.67)]
stars = []
for _ in range(40):
    jd = float(rng.uniform(2415020.5, 2469807.5))
    t = ts.tt_jd(jd)
    ra = float(rng.uniform(0, 360))
    dec = float(np.degrees(np.arcsin(rng.uniform(-1, 1))))
    name, la, lo = SITES[int(rng.integers(0, len(SITES)))]
    obs = de421['earth'] + wgs84.latlon(la, lo)
    alt, az, _ = obs.at(t).observe(Star(ra_hours=ra / 15, dec_degrees=dec)).apparent().altaz()
    stars.append({'jd_tt': jd, 'ut1': float(t.ut1), 'ra': ra, 'dec': dec, 'lat': la, 'lon': lo,
                  'alt': alt.degrees, 'az': az.degrees})
out['stars'] = stars

# ---- rise / transit / set for Sun and Moon ----
rs = []
for (name, la, lo) in SITES:
    obs = wgs84.latlon(la, lo)
    for _ in range(14):
        jd0 = math.floor(float(rng.uniform(2433282.5, 2469807.5))) + 0.5  # 1950..2050, 0h UTC
        t0 = ts.ut1_jd(jd0)
        t1 = ts.ut1_jd(jd0 + 1)
        for body in ('sun', 'moon'):
            target = de421[body]
            ev = {}
            for kind, fn in (('rise', almanac.find_risings), ('set', almanac.find_settings)):
                t, y = fn(de421['earth'] + obs, target, t0, t1)
                ev[kind] = [{'ut1': float(tt.ut1), 'tt': float(tt.tt), 'real': bool(yy)} for tt, yy in zip(t, y)]
            t = almanac.find_transits(de421['earth'] + obs, target, t0, t1)
            ev['transit'] = [{'ut1': float(tt.ut1), 'tt': float(tt.tt)} for tt in t]
            rs.append({'site': name, 'lat': la, 'lon': lo, 'body': body, 'ut1_0': jd0,
                       'dt': float((t0.tt - t0.ut1) * 86400), **ev})
out['riseset'] = rs

# ---- Moon phases ----
phases = []
for (a, b, eph) in [(2415020.5, 2415020.5 + 400, de421), (2451544.5, 2451544.5 + 400, de421),
                    (2461041.5, 2461041.5 + 400, de421), (2469807.5, 2469807.5 + 200, de440),
                    (2487700.5, 2488069.5, de440)]:
    t, y = almanac.find_discrete(ts.tt_jd(a), ts.tt_jd(b), almanac.moon_phases(eph))
    for tt, yy in zip(t, y):
        phases.append({'tt': float(tt.tt), 'phase': int(yy)})
out['phases'] = phases

# ---- lunar eclipses 1900-2049 ----
t, y, det = eclipselib.lunar_eclipses(ts.tt_jd(2415020.5), ts.tt_jd(2469807.0), de421)
out['lunar_eclipses'] = [
    {'tt': float(t[i].tt), 'type': int(y[i]), 'umag': float(det['umbral_magnitude'][i]),
     'pmag': float(det['penumbral_magnitude'][i])} for i in range(len(t))]

# ---- solar eclipse gamma at each new moon 1990-2049 (DE421 geometric vectors) ----
ERAD = 6378.137


def gamma_at(jd):
    tt_ = ts.tt_jd(jd)
    e = de421['earth'].at(tt_).position.km
    m = de421['moon'].at(tt_).position.km - e
    s = de421['sun'].at(tt_).position.km - e
    axis = (m - s) / np.linalg.norm(m - s)
    perp = m - np.dot(m, axis) * axis
    return np.linalg.norm(perp) / ERAD, perp[2]


solar = []
t, y = almanac.find_discrete(ts.tt_jd(2447892.5), ts.tt_jd(2469807.0), almanac.moon_phases(de421))
for tt, yy in zip(t, y):
    if int(yy) != 0:
        continue
    jd = float(tt.tt)
    lo, hi = jd - 0.3, jd + 0.3
    for _ in range(60):
        a1 = lo + (hi - lo) / 3
        a2 = hi - (hi - lo) / 3
        if gamma_at(a1)[0] < gamma_at(a2)[0]:
            hi = a2
        else:
            lo = a1
    jm = (lo + hi) / 2
    g, z = gamma_at(jm)
    if g < 1.6:
        solar.append({'new_tt': jd, 'tt': jm, 'gamma': float(g) * (1 if z >= 0 else -1)})
out['solar_gamma'] = solar

# ---- Moon illuminated fraction and the position angle of the bright limb (the Sun's direction from the Moon) ----
from skyfield.trigonometry import position_angle_of
from skyfield.searchlib import find_minima, find_maxima
illum = []
for jd in jds[::4]:
    eph = eph_for(jd)
    t = ts.tt_jd(jd)
    e = eph['earth'].at(t)
    m = e.observe(eph['moon']).apparent()
    s = e.observe(eph['sun']).apparent()
    mra, mdec, _ = m.radec(epoch='date')
    sra, sdec, _ = s.radec(epoch='date')
    illum.append({'jd_tt': jd, 'k': float(almanac.fraction_illuminated(eph, 'moon', t)),
                  'chi': float(position_angle_of((mdec, mra), (sdec, sra)).degrees)})
out['illum'] = illum

# ---- perigee and apogee: extrema of the geocentric Earth-Moon distance, 2026-2028 and 1960-1961 ----


def moon_dist(t):
    return (de421['moon'] - de421['earth']).at(t).distance().km


moon_dist.step_days = 1.0
aps = []
for (a, b) in [(2461041.5, 2461041.5 + 1095), (2436934.5, 2436934.5 + 730)]:
    tmin, dmin = find_minima(ts.tt_jd(a), ts.tt_jd(b), moon_dist)
    tmax, dmax = find_maxima(ts.tt_jd(a), ts.tt_jd(b), moon_dist)
    aps += [{'tt': float(x.tt), 'km': float(d), 'kind': 'perigee'} for x, d in zip(tmin, dmin)]
    aps += [{'tt': float(x.tt), 'km': float(d), 'kind': 'apogee'} for x, d in zip(tmax, dmax)]
out['apsides'] = aps

# ---- cosmology ----
cos = FlatLambdaCDM(H0=67.7, Om0=0.31, Tcmb0=0)
zs = [0.001, 0.01, 0.05, 0.1, 0.3, 0.5, 1.0, 2.0, 3.0, 5.0, 10.0]
out['cosmo'] = [{'z': z, 'dc': cos.comoving_distance(z).to(u.Mpc).value, 'dl': cos.luminosity_distance(z).to(u.Mpc).value,
                 'da': cos.angular_diameter_distance(z).to(u.Mpc).value, 'lookback': cos.lookback_time(z).to(u.Gyr).value,
                 'age': cos.age(z).to(u.Gyr).value} for z in zs]
out['cosmo_age0'] = cos.age(0).to(u.Gyr).value
cos_rad = FlatLambdaCDM(H0=67.7, Om0=0.31, Tcmb0=2.7255)
out['cosmo_radiation_dc_ratio_z1'] = float(cos_rad.comoving_distance(1.0).value / cos.comoving_distance(1.0).value)

with open(OUT, 'w') as f:
    json.dump(out, f, indent=None, separators=(',', ':'))
print('wrote', OUT, {k: (len(v) if isinstance(v, list) else v) for k, v in out.items()})
