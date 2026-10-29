"""Oracle for the VFX & compositing calculators (src/lib/vfxTime.ts, vfxCamera.ts, vfxGeometry.ts, vfxColour.ts).

Run:  ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/vfx-oracle.py
Writes src/lib/__tests__/fixtures/vfx-oracle.json.

Sources, by part:
  Camera log curves   colour-science 0.4.7 colour.LOG_ENCODINGS / LOG_DECODINGS at their defaults (LogC3: SUP 3.x,
                      EI 800, linear scene exposure; S-Log3 / V-Log: 10-bit normalised code values, in_reflection
                      True; Log3G10: v3; Cineon: black offset 10^((95 - 685)/300)). The published 18 % grey code values
                      are pinned separately in the test (the second source).
  Y'CbCr              colour.RGB_to_YCbCr with WEIGHTS_YCBCR["ITU-R BT.601"] / ["ITU-R BT.709"], full-range floats.
  Rotations           scipy.spatial.transform.Rotation.from_euler with LOWER-CASE (extrinsic) axes: a DCC rotate order
                      "XYZ" rotates about X first about the fixed axes. as_matrix and as_quat (scalar last).
  TRS about a pivot   numpy: M = T(t) T(p) R S T(-p), the inverse by numpy.linalg.inv, points applied.
  Retime curves       scipy.interpolate.PchipInterpolator (values, derivatives, integrals) and CubicHermiteSpline
                      with zero slopes (ease) and secant slopes (linear).
  Projection          numpy pinhole: camera looks down local -Z, pixels origin top-left.
  Fresnel             the exact unpolarised dielectric Fresnel equations written out here, and Schlick.
"""
import json
import os

import numpy as np
import colour
from scipy.interpolate import CubicHermiteSpline, PchipInterpolator
from scipy.spatial.transform import Rotation

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "__tests__", "fixtures", "vfx-oracle.json")

out = {"colour_science": colour.__version__}

# ---- log curves -------------------------------------------------------------------------------------------------
CURVES = {
    "logc3": "ARRI LogC3",
    "logc4": "ARRI LogC4",
    "slog3": "S-Log3",
    "vlog": "V-Log",
    "log3g10": "Log3G10",
    "acescct": "ACEScct",
    "acescc": "ACEScc",
    "cineon": "Cineon",
}
LIN = [-0.005, 0.0, 0.0005, 0.005, 0.01, 0.0106, 0.011, 0.05, 0.09, 0.18, 0.36, 0.9, 1.0, 2.0, 8.0, 16.0, 40.0]
CODE = [0.0, 0.05, 0.0928, 0.1, 0.125, 0.15, 0.2, 0.3, 0.391, 0.41, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
logs = {}
for key, name in CURVES.items():
    enc = colour.LOG_ENCODINGS[name]
    dec = colour.LOG_DECODINGS[name]
    pts = []
    for x in LIN:
        if key == "acescc" and x <= 0:
            continue
        if key == "cineon" and x < -0.0108:
            continue
        with np.errstate(all="ignore"):
            y = float(enc(x))
        if np.isfinite(y):
            pts.append([x, y])
    inv = []
    for y in CODE:
        with np.errstate(all="ignore"):
            x = float(dec(y))
        if np.isfinite(x):
            inv.append([y, x])
    logs[key] = {"encode": pts, "decode": inv}
out["log"] = logs

# ---- Y'CbCr ------------------------------------------------------------------------------------------------------
RGBS = [[0.0, 0.0, 0.0], [1.0, 1.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0], [0.1, 0.6, 0.15], [0.35, 0.55, 0.3], [0.2, 0.3, 0.8]]
ycc = {}
for m, kname in (("601", "ITU-R BT.601"), ("709", "ITU-R BT.709")):
    K = colour.WEIGHTS_YCBCR[kname]
    ycc[m] = [[rgb, [float(v) for v in colour.RGB_to_YCbCr(np.array(rgb), K=K, in_legal=False, out_legal=False, in_int=False, out_int=False)]] for rgb in RGBS]
out["ycbcr"] = ycc

# ---- rotations ---------------------------------------------------------------------------------------------------
ORDERS = ["XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"]
ANGLES = [[30.0, 45.0, 60.0], [-20.0, 10.0, 135.0], [90.0, 0.0, 0.0], [12.5, -77.0, 200.0]]
rots = []
for o in ORDERS:
    for a in ANGLES:
        # Angles are given BY AXIS (rx, ry, rz); scipy wants them in the order's sequence.
        by = {"X": a[0], "Y": a[1], "Z": a[2]}
        seq = [by[c] for c in o]
        r = Rotation.from_euler(o.lower(), seq, degrees=True)
        q = r.as_quat()
        if q[3] < 0:
            q = -q
        rots.append({"order": o, "angles": a, "matrix": r.as_matrix().tolist(), "quat": q.tolist(), "rotvec_deg": np.degrees(r.as_rotvec()).tolist()})
out["rotations"] = rots

# ---- TRS about a pivot -------------------------------------------------------------------------------------------
def trs(t, rdeg, s, order, p):
    by = {"X": rdeg[0], "Y": rdeg[1], "Z": rdeg[2]}
    R = Rotation.from_euler(order.lower(), [by[c] for c in order], degrees=True).as_matrix()
    def T(v):
        m = np.eye(4)
        m[:3, 3] = v
        return m
    R4 = np.eye(4)
    R4[:3, :3] = R
    S4 = np.diag([s[0], s[1], s[2], 1.0])
    return T(t) @ T(p) @ R4 @ S4 @ T(-np.array(p))

trs_cases = []
for case in [
    dict(t=[1.0, 2.0, 3.0], r=[30.0, 45.0, 60.0], s=[1.0, 2.0, 0.5], order="XYZ", p=[0.5, 0.0, -1.0], pts=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [2.0, -1.0, 4.0]]),
    dict(t=[0.0, 0.0, 0.0], r=[0.0, 90.0, 0.0], s=[1.0, 1.0, 1.0], order="ZXY", p=[0.0, 0.0, 0.0], pts=[[1.0, 0.0, 0.0]]),
    dict(t=[-5.0, 0.0, 2.5], r=[10.0, -20.0, 30.0], s=[-1.0, 1.0, 1.0], order="ZYX", p=[1.0, 1.0, 1.0], pts=[[0.0, 0.0, 0.0], [3.0, 2.0, 1.0]]),
]:
    M = trs(case["t"], case["r"], case["s"], case["order"], case["p"])
    trs_cases.append({**case, "M": M.tolist(), "inv": np.linalg.inv(M).tolist(), "det": float(np.linalg.det(M[:3, :3])),
                      "out": [(M @ np.array(p + [1.0]))[:3].tolist() for p in case["pts"]]})
out["trs"] = trs_cases

# ---- retime curves -----------------------------------------------------------------------------------------------
KEYS = [[1001.0, 100.0], [1013.0, 25.0], [1060.0, 25.0], [1075.0, 100.0]]
KEYS2 = [[0.0, 0.0], [10.0, 4.0], [20.0, 30.0], [35.0, 31.0], [50.0, 60.0]]
curves = []
for keys in (KEYS, KEYS2):
    x = np.array([k[0] for k in keys])
    y = np.array([k[1] for k in keys])
    sec = np.diff(y) / np.diff(x)
    pch = PchipInterpolator(x, y)
    # ease: zero slopes at every key; linear: secant slopes per segment (a piecewise line; evaluated with np.interp).
    ease = CubicHermiteSpline(x, y, np.zeros_like(y))
    xs = np.linspace(x[0], x[-1], 23)
    curves.append({
        "keys": keys,
        "x": xs.tolist(),
        "pchip": pch(xs).tolist(),
        "pchip_d": pch.derivative()(xs).tolist(),
        "pchip_int": [float(pch.integrate(x[0], v)) for v in xs],
        "pchip_slopes": pch.derivative()(x).tolist(),
        "ease": ease(xs).tolist(),
        "ease_int": [float(ease.integrate(x[0], v)) for v in xs],
        "linear": np.interp(xs, x, y).tolist(),
    })
out["curves"] = curves

# ---- projection --------------------------------------------------------------------------------------------------
def project(cam, rot, order, f, W, H, resW, resH, p):
    by = {"X": rot[0], "Y": rot[1], "Z": rot[2]}
    R = Rotation.from_euler(order.lower(), [by[c] for c in order], degrees=True).as_matrix()
    pc = R.T @ (np.array(p) - np.array(cam))
    depth = -pc[2]
    xf, yf = f * pc[0] / depth, f * pc[1] / depth
    k = resW / W
    return {"pc": pc.tolist(), "u": resW / 2 + xf * k, "v": resH / 2 - yf * k}

proj = []
for c in [
    dict(cam=[0.0, 1.6, 10.0], rot=[-5.0, 15.0, 0.0], order="ZXY", f=35.0, W=36.7, H=25.54, resW=4448, resH=3096, p=[1.0, 1.0, 0.0]),
    dict(cam=[2.0, 0.5, 4.0], rot=[10.0, -30.0, 5.0], order="XYZ", f=50.0, W=24.88, H=14.0, resW=4096, resH=2304, p=[-1.0, 0.8, -3.0]),
]:
    proj.append({**c, **project(c["cam"], c["rot"], c["order"], c["f"], c["W"], c["H"], c["resW"], c["resH"], c["p"])})
out["projection"] = proj

# ---- Fresnel -----------------------------------------------------------------------------------------------------
def fresnel(n, c):
    s2 = (1 - c * c) / (n * n)
    ct = np.sqrt(1 - s2)
    rs = (c - n * ct) / (c + n * ct)
    rp = (n * c - ct) / (n * c + ct)
    return float((rs * rs + rp * rp) / 2)

out["fresnel"] = [[n, c, fresnel(n, c), float(((n - 1) / (n + 1)) ** 2 + (1 - ((n - 1) / (n + 1)) ** 2) * (1 - c) ** 5)] for n in (1.33, 1.5, 2.4) for c in (1.0, 0.8, 0.5, 0.2, 0.05)]

with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(out, fh, indent=1)
print("wrote", os.path.normpath(OUT))
