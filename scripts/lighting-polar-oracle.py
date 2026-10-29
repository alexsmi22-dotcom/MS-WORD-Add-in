"""
Oracle for the high-latitude day classification and the golden/blue-hour windows of src/lib/lightingPhysics.ts
(sunEvents): writes src/lib/__tests__/fixtures/lighting-polar-oracle.json.

Run:  ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/lighting-polar-oracle.py

Independence: nothing here reads the TypeScript. For each local date, pvlib 0.16.1 NREL SPA ('nrel_numpy') geometric
elevation is sampled every 30 s over [00:00, 24:00] of the local date (fixed UTC offset); every band edge is refined by
scipy brentq on SPA itself. The stretches inside each band (sun up: above -0.8333 deg; golden: -4..6 deg; blue: -6..-4
deg) are built from those samples, with flags for a stretch already running at 00:00 or still running at 24:00.
pvlib's own sun_rise_set_transit_spa is recorded beside them (NaN where SPA finds no rise or set).
"""
import json
import math
import os

import numpy as np
import pandas as pd
import pvlib
from scipy.optimize import brentq

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "__tests__", "fixtures", "lighting-polar-oracle.json")

CASES = [
    ("Tromso rises only", 69.6492, 18.9553, "2026-05-18", 2),
    ("Tromso sets only", 69.6492, 18.9553, "2026-07-25", 2),
    ("Tromso midwinter", 69.6492, 18.9553, "2026-12-21", 1),
    ("Tromso midsummer", 69.6492, 18.9553, "2026-06-21", 2),
    ("89S equinox", -89.0, 0.0, "2026-03-20", 0),
    ("89S September", -89.0, 0.0, "2026-09-23", 0),
    ("89N equinox", 89.0, 0.0, "2026-03-20", 0),
    ("89N September", 89.0, 0.0, "2026-09-23", 0),
]


def windows(t, e, lo, hi, elev):
    inside = (e >= lo) & (e <= hi)
    out = []
    start = 0.0 if inside[0] else None
    open_start = bool(inside[0])
    for i in range(1, len(t)):
        if inside[i] == inside[i - 1]:
            continue
        h = lo if (e[i - 1] - lo) * (e[i] - lo) <= 0 else hi
        x = brentq(lambda m: elev(m) - h, t[i - 1], t[i], xtol=1e-5)
        if inside[i]:
            start, open_start = x, False
        else:
            out.append({"start": start, "end": x, "openStart": open_start, "openEnd": False})
            start, open_start = None, False
    if start is not None:
        out.append({"start": start, "end": 1440.0, "openStart": open_start, "openEnd": True})
    return out


def main():
    res = []
    for name, lat, lon, date, off in CASES:
        tz = "Etc/GMT%+d" % (-off) if off != 0 else "UTC"
        day0 = pd.Timestamp(date + " 00:00:00").tz_localize(tz)
        t = np.arange(0, 1440.0001, 0.5)
        idx = pd.DatetimeIndex([day0 + pd.Timedelta(minutes=float(m)) for m in t])
        e = pvlib.solarposition.get_solarposition(idx, lat, lon, method="nrel_numpy")["elevation"].to_numpy()

        def elev(m):
            ti = pd.DatetimeIndex([day0 + pd.Timedelta(minutes=float(m))])
            return float(pvlib.solarposition.get_solarposition(ti, lat, lon, method="nrel_numpy")["elevation"].iloc[0])

        lit = windows(t, e, -0.8333, math.inf, elev)
        spa = pvlib.solarposition.sun_rise_set_transit_spa(pd.DatetimeIndex([day0 + pd.Timedelta(hours=12)]), lat, lon)

        def mins(v):
            return None if pd.isna(v) else (v - day0).total_seconds() / 60.0

        res.append({
            "name": name, "lat": lat, "lon": lon, "date": date, "offset": off,
            "minElevation": float(e.min()), "maxElevation": float(e.max()),
            "lit": lit, "litMinutes": float(sum(w["end"] - w["start"] for w in lit)),
            "golden": windows(t, e, -4.0, 6.0, elev),
            "blue": windows(t, e, -6.0, -4.0, elev),
            "spaSunrise": mins(spa["sunrise"].iloc[0]), "spaSunset": mins(spa["sunset"].iloc[0]),
        })
        print(name, round(res[-1]["litMinutes"], 2), [(round(w["start"], 2), round(w["end"], 2)) for w in res[-1]["golden"]])
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"generator": "scripts/lighting-polar-oracle.py", "pvlib": pvlib.__version__, "cases": res}, fh, indent=1)


if __name__ == "__main__":
    main()
