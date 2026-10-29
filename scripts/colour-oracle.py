"""Oracle for the colour section (src/lib/colourScience.ts): colour-science 0.4.7, numpy.

Run:  ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/colour-oracle.py
Writes src/lib/__tests__/fixtures/colour-oracle.json.

Sources, by quantity:
  Sharma, Wu & Dalal (2005) CIEDE2000 table   the 34 published pairs and their 4-decimal values, read MECHANICALLY
                                              from colour-science's own test module
                                              (colour/difference/tests/test_delta_e.py, test_delta_E_CIE2000_Sharma2004),
                                              including pair 14, which that test leaves commented out for a
                                              platform-dependent atan2 rounding (the comment lines are un-commented).
  dE76, dE94, CMC, dE00                       colour.difference.delta_E_CIE1976 / _CIE1994(textiles) / _CMC(l, c);
                                              dE00 with general kL:kC:kH from colour's
                                              intermediate_attributes_CIE2000 (colour's delta_E_CIE2000 only offers
                                              kL = 1 or 2).
  conversions                                 colour.XYZ_to_Lab, Lab_to_XYZ, Lab_to_LCHab, XYZ_to_Luv, Luv_to_XYZ,
                                              Luv_to_uv, XYZ_to_xy, XYZ_to_sRGB / sRGB_to_XYZ with Bradford
                                              adaptation, whites from colour.CCS_ILLUMINANTS.
  chromatic adaptation                        colour.adaptation.chromatic_adaptation_VonKries (Bradford, Von Kries,
                                              CAT02, CAT16).
  spectral -> XYZ                             colour.sd_to_XYZ(method="ASTM E308" and "Integration") with the CMFs
                                              trimmed to 360-780 nm; the white is sd_to_XYZ of a flat 1.0 spectrum on
                                              the same shape. Test spectra: colour.SDS_COLOURCHECKERS["BabelColor
                                              Average"] patches (10 nm, 380-730 nm) and grids derived from them.
  ASTM E2022 weights                          colour.colorimetry.tristimulus_weighting_factors_ASTME2022.
  dominant wavelength, purity                 colour.dominant_wavelength, colour.excitation_purity, same CMFs.
  whiteness, yellowness                       colour.colorimetry.whiteness_CIE2004, yellowness_ASTME313,
                                              yellowness_ASTMD1925.
  metamerism index                            colour.difference.Lab_to_metamerism_index (additive),
                                              XYZ_to_metamerism_index (multiplicative).
  WCAG 2.x                                    the published formula (no colour-science function); the W3C example
                                              #777777 on #FFFFFF.
"""
import json
import os
import re

import colour
import numpy as np
from colour.colorimetry.yellowness import YELLOWNESS_COEFFICIENTS_ASTME313
from colour.difference.delta_e import intermediate_attributes_CIE2000

assert colour.__version__ == "0.4.7"
np.random.seed(20261028)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "lib", "__tests__", "fixtures", "colour-oracle.json")
O2 = "CIE 1931 2 Degree Standard Observer"
O10 = "CIE 1964 10 Degree Standard Observer"
OBS = {"2": O2, "10": O10}
ILL = {"D65": "D65", "D50": "D50", "A": "A", "C": "C", "F2": "FL2", "F7": "FL7", "F11": "FL11", "D55": "D55", "D75": "D75"}
SHAPE = colour.SpectralShape(360, 780, 1)
CMFS = {k: colour.MSDS_CMFS[v].copy().trim(SHAPE) for k, v in OBS.items()}
fx = {}


def L(a):
    return [float(v) for v in np.ravel(a)]


# ---- Sharma 2005: read the arrays from colour-science's test module ------------------------------------------
src = open(os.path.join(os.path.dirname(colour.__file__), "difference", "tests", "test_delta_e.py"), encoding="utf-8").read()
body = src[src.index("def test_delta_E_CIE2000_Sharma2004"):]
body = body[: body.index("np.testing.assert_allclose")]


def grab(name):
    seg = body[body.index(name + " = np.array(") :]
    seg = seg[: seg.index("\n        )\n") + 10]
    rows = []
    for line in seg.splitlines():
        t = line.strip()
        if t.startswith("# ["):
            t = t[2:]
        elif t.startswith("# ") and re.match(r"# \d", t):
            t = t[2:]
        if t.startswith("[") and t.endswith("],"):
            rows.append([float(v) for v in t[1:-2].split(",")])
        elif re.match(r"^\d+\.\d+,$", t):
            rows.append(float(t[:-1]))
    return rows


S1, S2, SD = grab("Lab_1"), grab("Lab_2"), grab("d_E")
assert len(S1) == len(S2) == len(SD) == 34, (len(S1), len(S2), len(SD))
assert S1[13] == [50.0, -0.001, 2.49] and S2[13] == [50.0, 0.001, -2.49] and SD[13] == 4.8045
fx["sharma"] = [{"std": a, "smp": b, "dE": d} for a, b, d in zip(S1, S2, SD)]


# ---- Difference formulas ---------------------------------------------------------------------------------------
def de00k(l1, l2, kL, kC, kH):
    S_L, S_C, S_H, dL, dC, dH, R_T = (
        np.asarray(v) for v in (lambda a: (a.S_L, a.S_C, a.S_H, a.delta_L_p, a.delta_C_p, a.delta_H_p, a.R_T))(intermediate_attributes_CIE2000(l1, l2))
    )
    return float(np.sqrt((dL / (kL * S_L)) ** 2 + (dC / (kC * S_C)) ** 2 + (dH / (kH * S_H)) ** 2 + R_T * (dC / (kC * S_C)) * (dH / (kH * S_H))))


pairs = []
edge = [
    ([50, 0, 0], [50, 0, 0]),
    ([50, 0, 0], [52, 1, -1]),
    ([60, 10, 0.5], [60, 10, -0.5]),  # hue wrap across 0/360
    ([60, 20, -1], [61, 20, 1.5]),
    ([40, -30, 0.1], [40, -30, -0.1]),  # near 180
    ([40, -25, 5], [42, -28, 8]),  # negative a*
    ([30, 0.0, 5], [30, -0.0, -5]),
    ([10, 2, 3], [12, 3, 2]),  # L < 16 for CMC
    ([95, -1, 3], [96, -0.5, 4]),
    ([50, 2.5, 0], [50, 0, -2.5]),
    ([70, 60, 60], [68, 62, 55]),
    ([45, 52, 28], [46.2, 49.5, 30.1]),
]
for a, b in edge:
    pairs.append((a, b))
for _ in range(120):
    a = [np.random.uniform(5, 98), np.random.uniform(-80, 80), np.random.uniform(-80, 80)]
    b = [a[0] + np.random.normal(0, 3), a[1] + np.random.normal(0, 4), a[2] + np.random.normal(0, 4)]
    pairs.append((a, b))
for _ in range(30):
    a = [np.random.uniform(5, 98), np.random.uniform(-100, 100), np.random.uniform(-100, 100)]
    b = [np.random.uniform(5, 98), np.random.uniform(-100, 100), np.random.uniform(-100, 100)]
    pairs.append((a, b))
diffs = []
for a, b in pairs:
    a = np.array(a, float)
    b = np.array(b, float)
    diffs.append(
        {
            "std": L(a),
            "smp": L(b),
            "de76": float(colour.difference.delta_E_CIE1976(a, b)),
            "de94g": float(colour.difference.delta_E_CIE1994(a, b, textiles=False)),
            "de94t": float(colour.difference.delta_E_CIE1994(a, b, textiles=True)),
            "cmc21": float(colour.difference.delta_E_CMC(a, b, l=2, c=1)),
            "cmc11": float(colour.difference.delta_E_CMC(a, b, l=1, c=1)),
            "de00": float(colour.difference.delta_E_CIE2000(a, b)),
            "de00_211": de00k(a, b, 2, 1, 1),
            "de00_k": de00k(a, b, 1.5, 0.8, 1.2),
            "lch_std": L(colour.Lab_to_LCHab(a)),
            "lch_smp": L(colour.Lab_to_LCHab(b)),
        }
    )
fx["diffs"] = diffs

# ---- Conversions ------------------------------------------------------------------------------------------------
xyz_samples = [[41.24, 21.26, 1.93], [20.0, 25.0, 30.0], [95.047, 100.0, 108.883], [5.0, 4.0, 12.0], [0.5, 0.3, 0.2], [60.0, 50.0, 10.0], [12.0, 30.0, 8.0]]
conv = []
for obs in ("2", "10"):
    for k, ck in ILL.items():
        xy_w = colour.CCS_ILLUMINANTS[OBS[obs]][ck]
        for XYZ in xyz_samples:
            X = np.array(XYZ) / 100
            Lab = colour.XYZ_to_Lab(X, xy_w)
            Luv = colour.XYZ_to_Luv(X, xy_w)
            conv.append(
                {
                    "obs": obs,
                    "ill": k,
                    "XYZ": XYZ,
                    "Lab": L(Lab),
                    "LCh": L(colour.Lab_to_LCHab(Lab)),
                    "Luv": L(Luv),
                    "upvp": L(colour.Luv_to_uv(Luv, xy_w)),
                    "xy": L(colour.XYZ_to_xy(X)),
                    "XYZ_from_Lab": L(colour.Lab_to_XYZ(Lab, xy_w) * 100),
                    "XYZ_from_Luv": L(colour.Luv_to_XYZ(Luv, xy_w) * 100),
                    "sRGB": L(colour.XYZ_to_sRGB(X, xy_w, chromatic_adaptation_transform="Bradford")),
                }
            )
fx["conversions"] = conv
srgb_in = [[1, 0, 0], [0.2, 0.4, 0.6], [0.5, 0.5, 0.5], [0, 0, 0], [1, 1, 1], [0.03, 0.9, 0.01]]
fx["srgb_to_xyz"] = [
    {"rgb": r, "obs": obs, "ill": k, "XYZ": L(colour.sRGB_to_XYZ(np.array(r, float), colour.CCS_ILLUMINANTS[OBS[obs]][ILL[k]], chromatic_adaptation_transform="Bradford") * 100)}
    for r in srgb_in
    for obs, k in (("2", "D65"), ("2", "D50"), ("10", "D65"), ("2", "A"))
]
cs = colour.RGB_COLOURSPACES["sRGB"]
fx["srgb_matrices"] = {"RGB_to_XYZ": L(cs.matrix_RGB_to_XYZ), "XYZ_to_RGB": L(cs.matrix_XYZ_to_RGB), "white": L(cs.whitepoint)}

# ---- Chromatic adaptation ---------------------------------------------------------------------------------------
cats = []
for tr, key in (("Bradford", "bradford"), ("Von Kries", "vonkries"), ("CAT02", "cat02"), ("CAT16", "cat16")):
    for src_i, dst_i, obs in (("D65", "D50", "2"), ("A", "D65", "10"), ("F11", "C", "2"), ("D50", "D75", "10")):
        Ws = colour.xy_to_XYZ(colour.CCS_ILLUMINANTS[OBS[obs]][ILL[src_i]]) * 100
        Wd = colour.xy_to_XYZ(colour.CCS_ILLUMINANTS[OBS[obs]][ILL[dst_i]]) * 100
        for XYZ in xyz_samples[:5]:
            out = colour.adaptation.chromatic_adaptation_VonKries(np.array(XYZ) / 100, Ws / 100, Wd / 100, transform=tr) * 100
            cats.append({"method": key, "from": src_i, "to": dst_i, "obs": obs, "XYZ": XYZ, "out": L(out)})
fx["cat"] = cats

# ---- Spectral -> XYZ --------------------------------------------------------------------------------------------
cc = colour.SDS_COLOURCHECKERS["BabelColor Average"]
names = list(cc.keys())
fx["colourchecker"] = {n: {"wl": L(cc[n].wavelengths), "v": L(cc[n].values)} for n in names}


def mk(wl, v):
    return colour.SpectralDistribution(dict(zip(wl, v)))


def xyz_of(sd, ill, obs, method):
    illum = colour.SDS_ILLUMINANTS[ILL[ill]]
    cm = CMFS[obs]
    XYZ = colour.sd_to_XYZ(sd, cm, illum, method=method)
    ones = mk(sd.wavelengths, np.ones(len(sd.wavelengths)))
    W = colour.sd_to_XYZ(ones, cm, illum, method=method)
    return XYZ, W


cases = []
specs = {}
sprague1 = {}
for n in names[:24]:
    base = cc[n]
    one = base.copy().interpolate(colour.SpectralShape(380, 730, 1))
    if n in names[:6]:
        sprague1[n] = L(one.values)
    grids = {
        "10nm-380-730": base,
        "1nm": one,
        "5nm": mk(one.wavelengths[::5], one.values[::5]),
        "20nm": mk(base.wavelengths[::2], base.values[::2]),
        "10nm-400-700": mk(base.wavelengths[2:34], base.values[2:34]),
    }
    for g, sd in grids.items():
        for ill, obs in (("D65", "10"), ("D65", "2"), ("A", "10"), ("F11", "2"), ("C", "2"), ("D50", "2"), ("F2", "10"), ("D75", "10")):
            for method in ("ASTM E308", "Integration"):
                if n not in names[:6] and (ill, obs) not in (("D65", "10"), ("A", "2"), ("F11", "2")):
                    continue
                XYZ, W = xyz_of(sd, ill, obs, method)
                specs[n + "|" + g] = {"wl": L(sd.wavelengths), "v": L(sd.values)}; cases.append({"spec": n + "|" + g, "ill": ill, "obs": obs, "method": method, "XYZ": L(XYZ), "white": L(W)})
# Off-tens 10 nm data (385-725), wider-than-practice data (340-800 at 10 nm, held ends), 2 nm data (integration only).
b0 = cc[names[0]]
one0 = b0.copy().interpolate(colour.SpectralShape(380, 730, 1))
extra = {
    "10nm-385-725": mk(one0.wavelengths[5:-5:10], one0.values[5:-5:10]),
    "10nm-340-800": mk(np.arange(340, 801, 10), np.concatenate([[b0.values[0]] * 4, b0.values, [b0.values[-1]] * 7])),
    "2nm": mk(one0.wavelengths[::2], one0.values[::2]),
}
for g, sd in extra.items():
    for method in ("ASTM E308", "Integration"):
        if g == "2nm" and method == "ASTM E308":
            continue
        XYZ, W = xyz_of(sd, "D65", "10", method)
        specs[names[0] + "|" + g] = {"wl": L(sd.wavelengths), "v": L(sd.values)}; cases.append({"spec": names[0] + "|" + g, "ill": "D65", "obs": "10", "method": method, "XYZ": L(XYZ), "white": L(W)})
fx["spectral"] = cases
fx["spectra"] = specs
fx["sprague1nm"] = sprague1
W10 = colour.colorimetry.tristimulus_weighting_factors_ASTME2022(
    CMFS["10"], colour.SDS_ILLUMINANTS["D65"].copy().align(SHAPE), colour.SpectralShape(360, 780, 10)
)
fx["weights_D65_10"] = [L(r) for r in W10]
W2A = colour.colorimetry.tristimulus_weighting_factors_ASTME2022(
    CMFS["2"], colour.SDS_ILLUMINANTS["A"].copy().align(SHAPE), colour.SpectralShape(360, 780, 10)
)
fx["weights_A_2"] = [L(r) for r in W2A]

# ---- Dominant wavelength --------------------------------------------------------------------------------------------
dom = []
for obs in ("2", "10"):
    xy_n = colour.CCS_ILLUMINANTS[OBS[obs]]["D65"]
    pts = [[0.5, 0.4], [0.2, 0.6], [0.2, 0.15], [0.4, 0.2], [0.35, 0.25], [0.6, 0.35], [0.25, 0.3], [0.32, 0.36], [0.45, 0.45], [0.15, 0.08]]
    for p in pts:
        wl, xy_wl, xy_cwl = colour.dominant_wavelength(np.array(p), xy_n, CMFS[obs])
        pe = colour.excitation_purity(np.array(p), xy_n, CMFS[obs])
        dom.append({"obs": obs, "xy": p, "white": L(xy_n), "wl": float(wl), "xy_wl": L(xy_wl), "xy_cwl": L(xy_cwl), "purity": float(pe)})
fx["dominant"] = dom

# ---- Whiteness / yellowness -------------------------------------------------------------------------------------
wy = []
for XYZ in ([90.0, 95.0, 110.0], [85.0, 88.0, 90.0], [93.0, 98.0, 115.0], [70.0, 72.0, 60.0], [88.5, 92.1, 96.3]):
    X = np.array(XYZ)
    row = {"XYZ": XYZ}
    for obs in ("2", "10"):
        xy_n = colour.CCS_ILLUMINANTS[OBS[obs]]["D65"]
        WT = colour.colorimetry.whiteness_CIE2004(colour.XYZ_to_xy(X / 100), X[1], xy_n, observer=OBS[obs])
        row["WT_" + obs] = L(WT)
        for ill in ("C", "D65"):
            co = YELLOWNESS_COEFFICIENTS_ASTME313[OBS[obs]][ill]
            row["YI_" + ill + "_" + obs] = float(colour.colorimetry.yellowness_ASTME313(X, co))
    row["YI_D1925"] = float(colour.colorimetry.yellowness_ASTMD1925(X))
    wy.append(row)
fx["whiteness"] = wy

# ---- Metamerism ---------------------------------------------------------------------------------------------------
# A synthetic metameric pair under D65/10 deg: the standard is a ColorChecker patch, the sample adds a "metameric
# black" (a smooth curve with its projection onto the three 10 nm weighting vectors removed) so the two match under
# D65 and differ under A and F11.
std = cc["neutral 5 (.70 D)"] if "neutral 5 (.70 D)" in cc else cc[names[21]]
wl = std.wavelengths
Wfull = colour.colorimetry.tristimulus_weighting_factors_ASTME2022(CMFS["10"], colour.SDS_ILLUMINANTS["D65"].copy().align(SHAPE), colour.SpectralShape(360, 780, 10))
Wsel = Wfull[2:38]
Wadj = colour.colorimetry.adjust_tristimulus_weighting_factors_ASTME308(Wfull, colour.SpectralShape(360, 780, 10), colour.SpectralShape(380, 730, 10))
assert Wadj.shape[0] == len(wl)
t = (wl - 555) / 175
curve = 0.08 * np.sin(3.2 * np.pi * t) + 0.05 * np.cos(5.1 * np.pi * t)
Q, _ = np.linalg.qr(Wadj)
black = curve - Q @ (Q.T @ curve)
smp_v = np.clip(std.values + black, 0.001, 0.999)
fx["metamer"] = {"wl": L(wl), "std": L(std.values), "smp": L(smp_v), "name": std.name}
sd_std = mk(wl, std.values)
sd_smp = mk(wl, smp_v)
met = []
for f, kw in (("de00", {"method": "CIE 2000"}), ("de76", {"method": "CIE 1976"}), ("cmc21", {"method": "CMC", "l": 2, "c": 1}), ("de94g", {"method": "CIE 1994"})):
    for test_ill in ("A", "F11", "F2", "D50"):
        X_sr, W_r = xyz_of(sd_std, "D65", "10", "ASTM E308")
        X_pr, _ = xyz_of(sd_smp, "D65", "10", "ASTM E308")
        X_st, W_t = xyz_of(sd_std, test_ill, "10", "ASTM E308")
        X_pt, _ = xyz_of(sd_smp, test_ill, "10", "ASTM E308")
        xy_r = colour.XYZ_to_xy(W_r)
        xy_t = colour.XYZ_to_xy(W_t)
        Lab = lambda X, xy: colour.XYZ_to_Lab(X / 100, xy)
        add = colour.difference.Lab_to_metamerism_index(Lab(X_pt, xy_t), Lab(X_st, xy_t), Lab(X_pr, xy_r), Lab(X_sr, xy_r), correction="Additive", **kw)
        mul = colour.difference.XYZ_to_metamerism_index(X_pt / 100, X_st / 100, X_pr / 100, X_sr / 100, correction="Multiplicative", illuminant=xy_t, **kw)
        raw = colour.difference.delta_E(Lab(X_st, xy_t), Lab(X_pt, xy_t), **kw)
        ref = colour.difference.delta_E(Lab(X_sr, xy_r), Lab(X_pr, xy_r), **kw)
        met.append({"formula": f, "test": test_ill, "additive": float(add), "multiplicative": float(mul), "raw": float(raw), "ref": float(ref)})
fx["metamerism"] = met


# ---- WCAG -------------------------------------------------------------------------------------------------------
def lum(rgb):
    v = np.array(rgb) / 255
    lin = np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)
    return float(0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2])


wc = []
for a, b in (("777777", "FFFFFF"), ("000000", "FFFFFF"), ("767676", "FFFFFF"), ("0000FF", "FFFFFF"), ("FF0000", "000000"), ("1F5FA8", "F5F5F5"), ("595959", "FFFFFF"), ("808080", "000000")):
    ra = [int(a[i : i + 2], 16) for i in (0, 2, 4)]
    rb = [int(b[i : i + 2], 16) for i in (0, 2, 4)]
    la, lb = lum(ra), lum(rb)
    wc.append({"fg": a, "bg": b, "Lfg": la, "Lbg": lb, "ratio": (max(la, lb) + 0.05) / (min(la, lb) + 0.05)})
fx["wcag"] = wc

with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    json.dump(fx, f, separators=(",", ":"))
print("wrote", os.path.normpath(OUT), sum(len(v) if isinstance(v, list) else 1 for v in fx.values()))
