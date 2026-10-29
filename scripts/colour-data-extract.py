"""Extracts the colour-science reference tables JurisLab's colour section bundles, and writes src/lib/colourData.ts.

Run:  ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/colour-data-extract.py
(colour-science 0.4.7, the oracle venv). Re-running it reproduces src/lib/colourData.ts byte for byte.

WHY A SCRIPT. The standing rule (colourspace.ts, flame.ts, elementData.ts) is that bundled reference data is taken
MECHANICALLY from a citable dataset, never typed from memory, and a crosscheck test guards it
(src/lib/__tests__/colourData.crosscheck.test.ts). Every number in colourData.ts is printed here with repr(), the
shortest string that round-trips the float colour-science holds.

WHAT IS TAKEN, AND AT WHAT GRID.
  - CIE 1931 2 deg and CIE 1964 10 deg colour-matching functions (colour.MSDS_CMFS, from the CIE/CVRL 1 nm tables),
    at 1 nm over 360-780 nm, the ASTM E308 practice range (colour.colorimetry.SPECTRAL_SHAPE_ASTME308). 1 nm and not
    5 nm because ASTM E308's 10 and 20 nm tristimulus weighting factors are built (ASTM E2022) from the 1 nm CMFs
    times the 1 nm illuminant; a 5 nm table cannot reproduce them. About 2,500 numbers.
  - Illuminant SPDs A, C, D50, D55, D65, D75, FL2, FL7, FL11 (colour.SDS_ILLUMINANTS, CIE 15 / CIE S 014-2 tables) at
    their NATIVE 5 nm grid, from 360 nm (or their first wavelength, 380 nm for the FL series) to 780 nm. colour-science
    interpolates these LINEARLY to 1 nm (their interpolator is LinearInterpolator) and holds the end value constant
    outside their range; colourScience.ts does the same.
  - Tabulated white-point chromaticities of the same nine illuminants for both observers (colour.CCS_ILLUMINANTS).
  - The sRGB matrices and white of IEC 61966-2-1 as colour-science holds them (the standard's two 4-decimal matrices,
    which are NOT exact inverses of each other: colour.RGB_COLOURSPACES["sRGB"], use_derived_matrix False).
  - The chromatic adaptation matrices Bradford, Von Kries, CAT02 and CAT16 (colour.adaptation.datasets.cat).
  - The ASTM E313 yellowness coefficients C_X, C_Z (colour.colorimetry.yellowness.YELLOWNESS_COEFFICIENTS_ASTME313).
"""
import os

import colour
import numpy as np
from colour.adaptation.datasets.cat import CAT_BRADFORD, CAT_CAT02, CAT_CAT16, CAT_VON_KRIES
from colour.colorimetry.yellowness import YELLOWNESS_COEFFICIENTS_ASTME313

assert colour.__version__ == "0.4.7", colour.__version__

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "lib", "colourData.ts")

OBS = {
    "2": "CIE 1931 2 Degree Standard Observer",
    "10": "CIE 1964 10 Degree Standard Observer",
}
ILLUMINANTS = ["A", "C", "D50", "D55", "D65", "D75", "FL2", "FL7", "FL11"]
# The keys the TypeScript side uses (FL2 is written F2 in most standards and instrument menus).
TS_KEY = {"FL2": "F2", "FL7": "F7", "FL11": "F11"}


def num(v):
    f = float(v)
    if f == 0:
        return "0"
    r = repr(f)
    if r.endswith(".0"):
        r = r[:-2]
    return r


def arr(values, per_line=12, indent="    "):
    vals = [num(v) for v in values]
    lines = [", ".join(vals[i : i + per_line]) for i in range(0, len(vals), per_line)]
    return "[\n" + ",\n".join(indent + l for l in lines) + ",\n" + indent[:-2] + "]"


def mat(m):
    return "[" + ", ".join("[" + ", ".join(num(v) for v in row) + "]" for row in np.asarray(m)) + "]"


out = []
w = out.append
w("// GENERATED FILE - do not edit by hand.")
w("//")
w("// Written by scripts/colour-data-extract.py from colour-science 0.4.7 (colour.MSDS_CMFS, colour.SDS_ILLUMINANTS,")
w("// colour.CCS_ILLUMINANTS, colour.RGB_COLOURSPACES[\"sRGB\"], colour.adaptation.datasets.cat and")
w("// colour.colorimetry.yellowness), which cite CIE 15:2004 / CIE S 014-1 and S 014-2 for the colour-matching functions")
w("// and illuminants, IEC 61966-2-1 for sRGB and ASTM E313 for the yellowness coefficients. Every number was printed")
w("// by the script (Python repr, the shortest round-trip form); none was typed by hand. Guarded by")
w("// src/lib/__tests__/colourData.crosscheck.test.ts against facts known independently of this file.")
w("//")
w("// Grids: the colour-matching functions at 1 nm over 360-780 nm (the ASTM E308 practice range; 1 nm because the")
w("// ASTM E2022 weighting factors for 10 and 20 nm data are built from 1 nm tables); the illuminants at their native")
w("// 5 nm grid, interpolated linearly to 1 nm at run time exactly as colour-science does.")
w("")
w("/** First and last wavelength (nm) of the bundled colour-matching functions; the step is 1 nm. */")
w("export const CMF_START = 360;")
w("export const CMF_END = 780;")
w("")
w("export interface CmfTable {")
w("  /** x-bar, y-bar, z-bar at CMF_START, CMF_START + 1, ... CMF_END nm. */")
w("  x: readonly number[];")
w("  y: readonly number[];")
w("  z: readonly number[];")
w("}")
w("")
for key, name in OBS.items():
    c = colour.MSDS_CMFS[name]
    wl = c.wavelengths
    sel = (wl >= 360) & (wl <= 780)
    assert sel.sum() == 421 and wl[sel][0] == 360 and wl[sel][-1] == 780
    assert np.all(np.diff(wl[sel]) == 1)
    v = c.values[sel]
    w(f"/** {name} (colour.MSDS_CMFS), 1 nm, 360-780 nm. */")
    w(f"export const CMF_{key}: CmfTable = {{")
    w("  x: " + arr(v[:, 0], indent="    ") + ",")
    w("  y: " + arr(v[:, 1], indent="    ") + ",")
    w("  z: " + arr(v[:, 2], indent="    ") + ",")
    w("};")
    w("")

w("export interface IlluminantSpd {")
w("  /** First wavelength (nm); values follow every `step` nm to 780 nm. */")
w("  start: number;")
w("  step: number;")
w("  values: readonly number[];")
w("}")
w("")
w("/** Relative spectral power distributions (colour.SDS_ILLUMINANTS), native 5 nm grid, from 360 nm (or the first")
w(" *  tabulated wavelength) to 780 nm. */")
w("export const ILLUMINANT_SPD: Record<string, IlluminantSpd> = {")
for k in ILLUMINANTS:
    sd = colour.SDS_ILLUMINANTS[k]
    assert sd.shape.interval == 5, (k, sd.shape)
    assert sd.interpolator.__name__ == "LinearInterpolator", (k, sd.interpolator)
    wl = sd.wavelengths
    sel = (wl >= 360) & (wl <= 780)
    start = float(wl[sel][0])
    assert wl[sel][-1] == 780
    w(f"  {TS_KEY.get(k, k)}: {{ start: {num(start)}, step: 5, values: " + arr(sd.values[sel], indent="      ") + " },")
w("};")
w("")
w("/** Tabulated white-point chromaticities (colour.CCS_ILLUMINANTS), CIE 1931 xy, per observer. */")
w("export const WHITE_XY: Record<\"2\" | \"10\", Record<string, readonly [number, number]>> = {")
for key, name in OBS.items():
    w(f"  \"{key}\": {{")
    for k in ILLUMINANTS:
        x, y = colour.CCS_ILLUMINANTS[name][k]
        w(f"    {TS_KEY.get(k, k)}: [{num(x)}, {num(y)}],")
    w("  },")
w("};")
w("")
cs = colour.RGB_COLOURSPACES["sRGB"]
assert cs.use_derived_matrix_RGB_to_XYZ is False and cs.use_derived_matrix_XYZ_to_RGB is False
w("/** IEC 61966-2-1 sRGB as colour-science holds it: the standard's 4-decimal matrices (not exact inverses). */")
w(f"export const SRGB_RGB_TO_XYZ: readonly (readonly number[])[] = {mat(cs.matrix_RGB_to_XYZ)};")
w(f"export const SRGB_XYZ_TO_RGB: readonly (readonly number[])[] = {mat(cs.matrix_XYZ_to_RGB)};")
w(f"export const SRGB_WHITE_XY: readonly [number, number] = [{num(cs.whitepoint[0])}, {num(cs.whitepoint[1])}];")
w("")
w("/** Chromatic adaptation (cone-response) matrices, colour.adaptation.datasets.cat. */")
w("export const CAT_MATRICES: Record<\"bradford\" | \"vonkries\" | \"cat02\" | \"cat16\", readonly (readonly number[])[]> = {")
w(f"  bradford: {mat(CAT_BRADFORD)},")
w(f"  vonkries: {mat(CAT_VON_KRIES)},")
w(f"  cat02: {mat(CAT_CAT02)},")
w(f"  cat16: {mat(CAT_CAT16)},")
w("};")
w("")
w("/** ASTM E313 yellowness coefficients [C_X, C_Z] by observer and illuminant. */")
w("export const E313_COEFFICIENTS: Record<\"2\" | \"10\", Record<\"C\" | \"D65\", readonly [number, number]>> = {")
for key, name in OBS.items():
    c = YELLOWNESS_COEFFICIENTS_ASTME313[name]
    w(f"  \"{key}\": {{ C: [{num(c['C'][0])}, {num(c['C'][1])}], D65: [{num(c['D65'][0])}, {num(c['D65'][1])}] }},")
w("};")
w("")

with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(out))
print("wrote", os.path.normpath(OUT))
