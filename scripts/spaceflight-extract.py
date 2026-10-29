# Mechanical extraction of the constants in src/lib/spaceConstants.ts (Spaceflight & missions, v2.206.0).
#
#   python -I scripts/spaceflight-extract.py GENERAL_PY APPROX_POS_HTML [PYMSIS_DIR] > out.ts.txt
#
# Inputs (downloaded 2026-10-28, kept outside the repo):
#   GENERAL_PY       https://raw.githubusercontent.com/poliastro/poliastro/main/src/poliastro/constants/general.py
#                    (the same file orbital.ts's BODIES were extracted from: IAU 2009 GM values, IAU WG CCRE 2009 radii)
#   APPROX_POS_HTML  https://ssd.jpl.nasa.gov/planets/approx_pos.html  (E. M. Standish, "Keplerian Elements for
#                    Approximate Positions of the Major Planets", Table 1, 1800 AD - 2050 AD, and the accuracy table)
#   PYMSIS_DIR       a directory holding pymsis 0.13 (pip install --target DIR --no-deps pymsis): NRLMSIS 2.1 densities
#
# Nothing is typed by hand: every number printed below is read from those inputs or computed by NRLMSIS 2.1. The
# printed block is pasted into spaceConstants.ts with the editor (never written by a shell), and spaceConstants.test.ts
# cross-checks it against facts known independently of these files (DE421 planet positions, GEO radius, ...).

import re
import sys


def gm_and_radii(path):
    src = open(path, encoding="utf-8").read()
    out = {}
    for m in re.finditer(r'^(\w+) = Constant\(\s*"(\w+)",\s*"([^"]*)",\s*([-0-9._eE+]+),\s*"([^"]*)"', src, re.M):
        out[m.group(1)] = (float(m.group(4).replace("_", "")), m.group(5), m.group(3))
    return out


def standish(path):
    html = open(path, encoding="utf-8").read()
    i = html.index("<h4>Table 1</h4>")
    pre = html[html.index("<pre>", i) + 5: html.index("</pre>", i)]
    rows = {}
    lines = [l for l in pre.splitlines() if l.strip()]
    k = 0
    while k < len(lines):
        m = re.match(r"^(Mercury|Venus|EM Bary|Mars|Jupiter|Saturn|Uranus|Neptune)\s+([-0-9.]+(?:\s+[-0-9.]+){5})\s*$", lines[k])
        if m:
            el = [float(x) for x in m.group(2).split()]
            rate = [float(x) for x in lines[k + 1].split()]
            assert len(el) == 6 and len(rate) == 6, lines[k]
            rows[m.group(1)] = (el, rate)
            k += 2
        else:
            k += 1
    assert len(rows) == 8, rows.keys()
    # Accuracy table (1800-2050 columns): lambda arcsec, phi arcsec, rho 1000 km.
    acc = {}
    j = html.index("1800 AD")
    seg = html[j: html.index("</table>", j)]
    for m in re.finditer(r"<th>(Mercury|Venus|EM Bary|Mars|Jupiter|Saturn|Uranus|Neptune)(?:<sup>[^<]*</sup>)?</th>((?:\s*<td>[^<]*</td>){6})", seg):
        tds = re.findall(r"<td>([^<]*)</td>", m.group(2))
        acc[m.group(1)] = [float(t) for t in tds[:3]]
    assert len(acc) == 8, acc.keys()
    return rows, acc


def msis_table(pymsis_dir):
    sys.path.insert(0, pymsis_dir)
    import numpy as np
    from pymsis import msis

    alts = list(range(86, 150, 2)) + list(range(150, 500, 10)) + list(range(500, 1001, 25))
    lats = np.arange(-80, 81, 10.0)
    lons = np.arange(0, 360, 30.0)
    w = np.cos(np.radians(lats))
    levels = {"low": (70.0, 4.0), "moderate": (150.0, 15.0), "high": (250.0, 45.0)}
    table = {}
    for name, (f107, ap) in levels.items():
        # One grid call: shape (1 date, lons, lats, alts, 11 outputs); output 0 is the total mass density.
        rho = msis.calculate(np.array([np.datetime64("2020-03-20T12:00")]), lons, lats, np.array(alts, dtype=float), f107s=[f107], f107as=[f107], aps=[[ap] * 7], version=2.1)[0, :, :, :, 0]
        by_lat = rho.mean(axis=0)  # (lats, alts)
        table[name] = [float(np.sum(by_lat[:, i] * w) / np.sum(w)) for i in range(len(alts))]
    return alts, table


def main():
    c = gm_and_radii(sys.argv[1])
    rows, acc = standish(sys.argv[2])
    p = print
    p("// ---- BEGIN GENERATED (scripts/spaceflight-extract.py) ----")
    names = ["sun", "mercury", "venus", "earth", "moon", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"]
    p("export const GM_SI: Record<string, number> = {")
    for n in names:
        p(f"  {n}: {c['GM_' + n][0]!r},")
    p("};")
    p("export const R_EQ_SI: Record<string, number> = {")
    for n in names:
        v, unit, _ = c["R_" + n]
        f = 1000.0 if unit.strip() == "km" else 1.0
        p(f"  {n}: {v * f!r},")
    p("};")
    p("export const R_MEAN_SI: Record<string, number> = {")
    for n in names[1:]:
        v, unit, _ = c["R_mean_" + n]
        f = 1000.0 if unit.strip() == "km" else 1.0
        p(f"  {n}: {v * f!r},")
    p("};")
    p("export const J2: Record<string, number> = {")
    for n in ["sun", "earth", "mars", "venus"]:
        p(f"  {n}: {c['J2_' + n][0]!r},")
    p("};")
    p(f"export const H0_EARTH_M = {c['H0_earth'][0]!r};")
    p(f"export const RHO0_EARTH = {c['rho0_earth'][0]!r};")
    p("/** [a au, e, I deg, L deg, long.peri deg, long.node deg] and the same per Julian century. */")
    p("export const STANDISH_T1: Record<string, { el: number[]; rate: number[]; err: number[] }> = {")
    for k, (el, rate) in rows.items():
        key = "emb" if k == "EM Bary" else k.lower()
        p(f"  {key}: {{ el: {el!r}, rate: {rate!r}, err: {acc[k]!r} }},")
    p("};")
    if len(sys.argv) > 3:
        alts, table = msis_table(sys.argv[3])
        p("/** NRLMSIS 2.1 total mass density, kg/m³: global mean (cos-latitude weighted, 12 longitudes), 2020-03-20 12:00 UT. */")
        p(f"export const MSIS_ALT_KM = {alts!r};")
        p("export const MSIS_RHO: Record<\"low\" | \"moderate\" | \"high\", number[]> = {")
        for k, col in table.items():
            p(f"  {k}: [{', '.join(format(v, '.5g') for v in col)}],")
        p("};")
    p("// ---- END GENERATED ----")


main()
