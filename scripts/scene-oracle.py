"""Oracle for the Scene modelling & pipeline calculators (v2.206.0): src/lib/sceneCurves.ts, sceneMesh.ts, sceneRay.ts,
scenePipeline.ts.

Run:  ~/jurislab-oracle-venv/Scripts/python.exe -I scripts/scene-oracle.py
Writes src/lib/__tests__/fixtures/scene-oracle.json.

Sources (venv: geomdl 5.4.0, scipy 1.18.1, trimesh 5.2.0, numpy 2.5.4):
  Bezier     scipy.interpolate.BSpline on the clamped knot vector [0]*(n+1) + [1]*(n+1) (a Bezier curve), its
             .derivative(1, 2) for C', C'' and the curvature; the arc length by scipy.integrate.quad of |C'| (epsabs
             1e-14); the bounding box from every sign change of each C' component on a 20,001-point grid, refined by
             brentq.
  NURBS      geomdl NURBS.Curve (evaluate_single, derivatives, operations.insert_knot) and, independently, scipy
             BSpline on the homogeneous points (w P, w) divided through (C' = (A' - w' C)/w).
  Meshes     trimesh.Trimesh(vertices, fan-triangulated faces, process=False) so nothing is merged or re-wound: area,
             volume, center_mass, euler_number, is_watertight, is_winding_consistent, bounds. Loop subdivision counts,
             area and volume from trimesh.remesh.subdivide_loop on a tetrahedron.
  Rays       sphere: the quadratic in numpy; box: an independent slab loop; triangle: the plane intersection, then
             trimesh.triangles.points_to_barycentric on the hit point (not Moller-Trumbore).
  Pipeline   texture mip chains, LPT schedules (heapq), Amdahl, DPX packing, SAH costs: independent plain-Python
             re-implementations of the stated formulas.
"""
import heapq
import json
import math
import os

import numpy as np
import trimesh
from geomdl import NURBS, operations
from scipy.integrate import quad
from scipy.interpolate import BSpline
from scipy.optimize import brentq
from trimesh import remesh

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "lib", "__tests__", "fixtures", "scene-oracle.json")
out = {"bezier": {}, "nurbs": {}, "fixtures": {}, "trimesh": {}, "loop": {}, "ray": {}, "pipeline": {}}

# ---------------------------------------------------------------- Bezier
def bez(P):
    P = np.array(P, float)
    n = len(P) - 1
    return BSpline(np.array([0.0] * (n + 1) + [1.0] * (n + 1)), P, n)

def bez_case(name, P, t):
    b = bez(P)
    d1 = b.derivative(1); d2 = b.derivative(2)
    v1 = d1(t); v2 = d2(t)
    nv = np.linalg.norm
    k = (v1[0] * v2[1] - v1[1] * v2[0]) / nv(v1) ** 3 if len(P[0]) == 2 else nv(np.cross(v1, v2)) / nv(v1) ** 3
    L, _ = quad(lambda s: nv(d1(s)), 0, 1, epsabs=1e-14, epsrel=1e-13, limit=500)
    lo, hi = [], []
    for kk in range(len(P[0])):
        f = lambda s: d1(s)[kk]
        ss = np.linspace(0, 1, 20001)
        vals = [f(s) for s in ss]
        cand = [0.0, 1.0]
        for i in range(len(ss) - 1):
            if vals[i] == 0:
                cand.append(ss[i])
            elif vals[i] * vals[i + 1] < 0:
                cand.append(brentq(f, ss[i], ss[i + 1], xtol=1e-15))
        vs = [b(s)[kk] for s in cand]
        lo.append(min(vs)); hi.append(max(vs))
    out["bezier"][name] = dict(P=P, t=t, point=b(t).tolist(), d1=v1.tolist(), d2=v2.tolist(), curvature=float(k), arc=L, bmin=lo, bmax=hi)

bez_case("cubic", [[0, 0], [1, 2], [3, 2], [4, 0]], 0.5)
bez_case("quartic3d", [[0, 0, 0], [1, 2, 0], [2, -1, 1], [3, 3, 2], [4, 0, 0]], 0.3)
bez_case("s_curve", [[0, 0], [3, 3], [-1, 3], [2, 0]], 0.25)
bez_case("degree7", [[0, 0], [1, 3], [2, -2], [3, 4], [4, -1], [5, 2], [6, -3], [7, 0]], 0.61)

# ---------------------------------------------------------------- NURBS
def nurbs(P, w, p, U):
    c = NURBS.Curve()
    c.degree = p
    c.ctrlptsw = [[x * wi for x in pt] + [wi] for pt, wi in zip(P, w)]
    c.knotvector = U
    return c

def nurbs_case(name, P, w, p, U, u, ins=None):
    c = nurbs(P, w, p, U)
    H = np.array([[x * wi for x in pt] + [wi] for pt, wi in zip(P, w)], float)
    s = BSpline(np.array(U, float), H, p)
    h = s(u); dh = s.derivative(1)(u)
    C = h[:-1] / h[-1]
    rec = dict(P=P, w=w, p=p, U=U, u=u, point=list(c.evaluate_single(u)), d1=list(c.derivatives(u, order=1)[1]),
               scipy_point=C.tolist(), scipy_d1=((dh[:-1] - dh[-1] * C) / h[-1]).tolist())
    if ins:
        c2 = nurbs(P, w, p, U)
        operations.insert_knot(c2, [ins[0]], [ins[1]])
        rec.update(ins=list(ins), ins_knots=list(c2.knotvector), ins_ctrlpts=[list(q) for q in c2.ctrlpts], ins_weights=list(c2.weights))
    out["nurbs"][name] = rec

r2 = math.sqrt(2) / 2
nurbs_case("quarter_circle", [[1, 0], [1, 1], [0, 1]], [1, r2, 1], 2, [0, 0, 0, 1, 1, 1], 0.3, (0.5, 1))
qc = nurbs([[1, 0], [1, 1], [0, 1]], [1, r2, 1], 2, [0, 0, 0, 1, 1, 1])
qc.delta = 1 / 2000
out["nurbs"]["quarter_circle"]["max_radial_err"] = max(abs(math.hypot(*q) - 1) for q in qc.evalpts)
nurbs_case("cubic_clamped_uniform", [[0, 0], [1, 2], [2, 3], [4, 3], [5, 1], [6, 0]], [1] * 6, 3, [0, 0, 0, 0, 1 / 3, 2 / 3, 1, 1, 1, 1], 0.37, (0.6, 1))
nurbs_case("rational_3d", [[0, 0, 0], [1, 2, 1], [2, 3, 0], [4, 3, -1], [5, 1, 2], [6, 0, 0]], [1, 2, 0.5, 1, 3, 1], 3, [0, 0, 0, 0, 0.2, 0.5, 1, 1, 1, 1], 0.42, (0.5, 2))
nurbs_case("c0_joint", [[0, 0], [1, 1], [2, 0], [3, 1], [4, 0]], [1] * 5, 2, [0, 0, 0, 0.5, 0.5, 1, 1, 1], 0.5)

# ---------------------------------------------------------------- Meshes
def obj(V, F):
    return "\n".join(["v %r %r %r" % tuple(float(c) for c in v) for v in V] + ["f " + " ".join(str(i + 1) for i in f) for f in F])

fx = {}
cubeV = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
cubeF = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
fx["cube"] = (cubeV, cubeF)
fx["box_offset"] = ([[x * 1.5 + 3, y * 0.5 - 1, z * 2 + 0.25] for x, y, z in cubeV], cubeF)
fx["open_box"] = (cubeV, cubeF[:1] + cubeF[2:])
flipped = [f[:] for f in cubeF]; flipped[3] = flipped[3][::-1]
fx["miswound"] = (cubeV, flipped)
fx["inside_out"] = (cubeV, [f[::-1] for f in cubeF])
fx["nonmanifold"] = ([[0, 0, 0], [1, 0, 0], [0.5, 1, 0], [0.5, -1, 0], [0.5, 0, 1]], [[0, 1, 2], [1, 0, 3], [0, 1, 4]])
TV, TF = [], []
nu, nv = 8, 6
for i in range(nu):
    for j in range(nv):
        u = 2 * math.pi * i / nu; v = 2 * math.pi * j / nv
        TV.append([(2 + 0.5 * math.cos(v)) * math.cos(u), (2 + 0.5 * math.cos(v)) * math.sin(u), 0.5 * math.sin(v)])
for i in range(nu):
    for j in range(nv):
        TF.append([i * nv + j, ((i + 1) % nu) * nv + j, ((i + 1) % nu) * nv + (j + 1) % nv, i * nv + (j + 1) % nv])
fx["torus"] = (TV, TF)
MV, MF = [], []
n = 8
for i in range(n):
    t = 2 * math.pi * i / n
    for s in (-0.3, 0.3):
        MV.append([(1 + s * math.cos(t / 2)) * math.cos(t), (1 + s * math.cos(t / 2)) * math.sin(t), s * math.sin(t / 2)])
for i in range(n):
    a, b = 2 * i, 2 * i + 1
    c, d = (2 * (i + 1) + 1, 2 * (i + 1)) if i < n - 1 else (0, 1)
    MF.append([a, d, c, b])
fx["mobius"] = (MV, MF)
fx["isolated_vertex"] = (cubeV + [[5, 5, 5]], cubeF)
tetV = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]
tetF = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]
fx["tetrahedron"] = (tetV, tetF)
pV = [[math.cos(2 * math.pi * k / 5), math.sin(2 * math.pi * k / 5), z] for z in (0.0, 1.0) for k in range(5)]
pF = [[4, 3, 2, 1, 0], [5, 6, 7, 8, 9]] + [[k, (k + 1) % 5, 5 + (k + 1) % 5, 5 + k] for k in range(5)]
fx["pentagonal_prism"] = (pV, pF)
for name, (V, F) in fx.items():
    out["fixtures"][name] = obj(V, F)
    tris = [[f[0], f[i], f[i + 1]] for f in F for i in range(1, len(f) - 1)]
    m = trimesh.Trimesh(np.array(V, float), np.array(tris), process=False)
    rec = dict(area=float(m.area), volume=float(m.volume), euler=int(m.euler_number), watertight=bool(m.is_watertight),
               winding_consistent=bool(m.is_winding_consistent), bounds=m.bounds.tolist(), triangles=len(tris))
    if m.is_watertight and m.is_winding_consistent and abs(m.volume) > 1e-12:
        rec["center_mass"] = m.center_mass.tolist()
    out["trimesh"][name] = rec
v0, f0 = np.array(tetV, float), np.array(tetF)
for it in range(1, 4):
    nv_, nf_ = remesh.subdivide_loop(v0, f0, iterations=it)
    mm = trimesh.Trimesh(nv_, nf_, process=False)
    out["loop"]["level%d" % it] = dict(V=len(nv_), F=len(nf_), E=len(mm.edges_unique), area=float(mm.area), volume=float(mm.volume), bmax=mm.bounds[1].tolist())

# ---------------------------------------------------------------- Rays
def unit(d):
    d = np.array(d, float); return d / np.linalg.norm(d)

def sphere(o, d, c, r):
    o, d, c = np.array(o, float), unit(d), np.array(c, float)
    oc = o - c; b = d @ oc; cc = oc @ oc - r * r; disc = b * b - cc
    if disc < 0:
        return dict(hit=False)
    t1, t2 = -b - math.sqrt(disc), -b + math.sqrt(disc)
    t = t1 if t1 >= 0 else t2
    return dict(hit=bool(t2 >= 0), tNear=float(t1), tFar=float(t2), point=(o + t * d).tolist())

def box(o, d, lo, hi):
    o, d = np.array(o, float), unit(d)
    tmin, tmax = -math.inf, math.inf
    for i in range(3):
        if d[i] == 0:
            if o[i] < lo[i] or o[i] > hi[i]:
                return dict(hit=False)
            continue
        a, b = sorted(((lo[i] - o[i]) / d[i], (hi[i] - o[i]) / d[i]))
        tmin, tmax = max(tmin, a), min(tmax, b)
    if tmin > tmax or tmax < 0:
        return dict(hit=False)
    t = tmin if tmin >= 0 else tmax
    return dict(hit=True, tNear=tmin, tFar=tmax, point=(o + t * d).tolist())

def tri(o, d, v):
    o, d = np.array(o, float), unit(d)
    v = np.array(v, float)
    n = np.cross(v[1] - v[0], v[2] - v[0])
    den = d @ n
    if abs(den) < 1e-15:
        return dict(hit=False, parallel=True)
    t = ((v[0] - o) @ n) / den
    p = o + t * d
    bary = trimesh.triangles.points_to_barycentric(v[None, :, :], p[None, :])[0]
    inside = bool(np.all(bary >= -1e-12))
    return dict(hit=bool(inside and t >= 0), t=t, point=p.tolist(), bary=bary.tolist(), back=bool(den > 0))

out["ray"]["sphere_default"] = sphere([0, 0.3, -5], [0, 0, 1], [0, 0, 0], 1)
out["ray"]["sphere_oblique"] = sphere([-3, 2, 1], [1, -0.5, -0.2], [0.5, 0.2, 0.1], 1.3)
out["ray"]["sphere_inside"] = sphere([0, 0, 0], [0, 0, 1], [0, 0, 0], 1)
out["ray"]["box_default"] = box([0, 0.3, -5], [0, 0, 1], [-1, -1, -1], [1, 1, 1])
out["ray"]["box_oblique"] = box([-4, -3, 0.5], [2, 1.5, 0.1], [-1, -1, -1], [1, 2, 1])
out["ray"]["tri_default"] = tri([0, 0.3, -5], [0, 0, 1], [[-1, -1, 0], [1, -1, 0], [0, 1, 0]])
out["ray"]["tri_oblique"] = tri([0.2, -2, 3], [0.1, 0.6, -1], [[-1, -1, 0.5], [2, -0.5, 0], [0, 1.5, -0.2]])

# ---------------------------------------------------------------- Pipeline
blocks = {"bc1": (4, 4, 8), "bc7": (4, 4, 16), "astc6x6": (6, 6, 16), "astc12x12": (12, 12, 16), "rgba8": (1, 1, 4)}
tex = {}
for (w, h) in [(2048, 2048), (1000, 600), (4096, 1024), (3, 5)]:
    for fid, (bw, bh, B) in blocks.items():
        lw, lh, total, levels = w, h, 0, 0
        while True:
            total += math.ceil(lw / bw) * math.ceil(lh / bh) * B; levels += 1
            if lw == 1 and lh == 1:
                break
            lw, lh = max(1, lw // 2), max(1, lh // 2)
        tex["%dx%d_%s" % (w, h, fid)] = dict(base=math.ceil(w / bw) * math.ceil(h / bh) * B, chain=total, levels=levels)
out["pipeline"]["texture"] = tex
out["pipeline"]["texel_density"] = math.sqrt(2048 * 2048 * 0.7 / 4)

def amdahl(s, c):
    return 1 / (s + (1 - s) / c)

def lpt(times, n):
    heap = [0.0] * n
    for t in sorted(times, reverse=True):
        x = heapq.heappop(heap); heapq.heappush(heap, x + t)
    return max(heap)

S = amdahl(0.05, 32)
tn = 8 * 3600 / S + 120
out["pipeline"]["farm_default"] = dict(speedup=S, node_frame=tn, wall=math.ceil(240 / 20) * tn,
                                        nodes_for_24h=min(n for n in range(1, 241) if math.ceil(240 / n) * tn <= 86400))
times = [3, 9, 6, 12, 2, 8, 7, 4]
out["pipeline"]["farm_lpt"] = dict(wall=lpt([t * 3600 / S + 120 for t in times], 3))
out["pipeline"]["dpx10_4096x2160x3"] = 4 * math.ceil(3 * 4096 / 3) * 2160
out["pipeline"]["dpx10_1920x1080x4"] = 4 * math.ceil(4 * 1920 / 3) * 1080
out["pipeline"]["exr_half_4096x2160x4"] = 2 * 4096 * 2160 * 4

def sah(P, axis, pos, ct, ci):
    L = [p for p in P if p[axis] < pos]; R = [p for p in P if p[axis] >= pos]
    def area(Q):
        e = [max(q[j] for q in Q) - min(q[j] for q in Q) for j in range(3)]
        return 2 * (e[0] * e[1] + e[1] * e[2] + e[2] * e[0])
    A = area(P)
    return ct + area(L) / A * len(L) * ci + area(R) / A * len(R) * ci

PTS = [[0, 0, 0], [1, 0.5, 0.2], [0.5, 1.5, 0], [2, 0.2, 0.4], [6, 1, 0.1], [6.5, 0.4, 0.3], [7, 1.2, 0], [7.2, 0.1, 0.5]]
out["pipeline"]["sah_x3"] = sah(PTS, 0, 3, 1, 1)
out["pipeline"]["sah_y07"] = sah(PTS, 1, 0.7, 1, 1)
f = 540 / math.tan(math.radians(30))
out["pipeline"]["lod"] = dict(focal=f, diameter=2 * f * 1 / 20, switch=[f * e / 1 for e in (0.0005, 0.002, 0.008, 0.03)])

with open(OUT, "w") as fh:
    json.dump(out, fh, indent=1)
print("wrote", OUT)
